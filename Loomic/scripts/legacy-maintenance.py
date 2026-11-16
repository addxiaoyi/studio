"""Prepare a narrow legacy API admission barrier; never reload or write host state."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
from typing import NamedTuple
from urllib.parse import urlsplit


SIDECAR_PORT = 3014
GALLERY_PATHS = {f'/{prefix}fashion-gallery/{kind}/'
                 for prefix in ('', 'api/public-media/') for kind in ('img', 'thumbs')}


class Token(NamedTuple):
    value: str
    start: int
    end: int
    delimiter: bool = False


class Directive(NamedTuple):
    words: tuple[str, ...]
    start: int
    end: int
    opening: int | None
    children: tuple[Directive, ...]


def tokenize(config: str) -> list[Token]:
    tokens = []
    offset = 0
    while offset < len(config):
        if config[offset].isspace():
            offset += 1
            continue
        if config[offset] == '#':
            newline = config.find('\n', offset)
            offset = len(config) if newline < 0 else newline + 1
            continue
        start = offset
        if config[offset] in '{};':
            tokens.append(Token(config[offset], offset, offset + 1, True))
            offset += 1
            continue
        word = []
        quote = None
        while offset < len(config):
            char = config[offset]
            if char == '\\':
                if offset + 1 == len(config):
                    raise ValueError('Unterminated Nginx escape')
                word.append(config[offset:offset + 2])
                offset += 2
                continue
            if quote:
                if char == quote:
                    quote = None
                else:
                    word.append(char)
                offset += 1
                continue
            if char in '\'"':
                quote = char
                offset += 1
                continue
            if char == '$' and config[offset:offset + 2] == '${':
                end = config.find('}', offset + 2)
                if end < 0:
                    raise ValueError('Unterminated Nginx variable')
                word.append(config[offset:end + 1])
                offset = end + 1
                continue
            if char.isspace() or char in '{};#':
                break
            word.append(char)
            offset += 1
        if quote:
            raise ValueError('Unterminated quoted Nginx argument')
        tokens.append(Token(''.join(word), start, offset))
    return tokens


def parse(config: str) -> tuple[Directive, ...]:
    tokens = tokenize(config)

    def scope(index: int, nested: bool) -> tuple[tuple[Directive, ...], int]:
        directives = []
        while index < len(tokens):
            if tokens[index].delimiter and tokens[index].value == '}':
                if not nested:
                    raise ValueError('Unexpected Nginx closing brace')
                return tuple(directives), index + 1
            start = tokens[index].start
            words = []
            while index < len(tokens) and not tokens[index].delimiter:
                words.append(tokens[index].value)
                index += 1
            if not words or index == len(tokens) or tokens[index].value == '}':
                raise ValueError('Nginx directive is missing a terminator')
            delimiter = tokens[index]
            index += 1
            children = ()
            opening = None
            end = delimiter.end
            if delimiter.value == '{':
                opening = delimiter.start
                children, index = scope(index, True)
                end = tokens[index - 1].end
            directives.append(Directive(tuple(words), start, end, opening, children))
        if nested:
            raise ValueError('Nginx block has no closing brace')
        return tuple(directives), index

    return scope(0, False)[0]


def walk(nodes: tuple[Directive, ...]):
    for node in nodes:
        yield node
        yield from walk(node.children)


def selector(node: Directive) -> str:
    return ' '.join(node.words[1:])


def literal_path(node: Directive) -> str | None:
    args = node.words[1:]
    if len(args) == 1 and args[0].startswith('/'):
        return args[0]
    if len(args) == 2 and args[0] in ('=', '^~') and args[1].startswith('/'):
        return args[1]
    return None


def is_api(path: str | None) -> bool:
    return bool(path and (path == '/api' or path.startswith('/api/')))


def is_main_ingress(path: str | None) -> bool:
    return is_api(path) or path == '/health'


def proxy_port(node: Directive) -> int | None:
    if node.words[0] != 'proxy_pass' or len(node.words) != 2:
        return None
    try:
        address = urlsplit(node.words[1])
        if address.hostname == '127.0.0.1' and address.scheme == 'http':
            return address.port
    except ValueError as error:
        raise ValueError('Malformed Nginx proxy upstream') from error
    return None


def explicit_upstream(node: Directive) -> bool:
    if len(node.words) != 2:
        return False
    try:
        address = urlsplit(node.words[1])
        host = address.hostname or ''
        return (address.scheme in ('http', 'https') and '$' not in host
                and ('.' in host or host in ('localhost', '::1')))
    except ValueError:
        return False


def unsafe_directive(node: Directive) -> str | None:
    if node.words[0] in ('include', 'rewrite'):
        return node.words[0]
    if node.words[0] == 'error_page' and '503' in node.words[1:]:
        return 'error_page'
    return None


def analyze(config: str, api_port: int) -> tuple[Directive, list[Directive], list[Directive], bool]:
    if type(api_port) is not int or not 1024 <= api_port <= 65535 or api_port == SIDECAR_PORT:
        raise ValueError('Expected an unprivileged main API port distinct from the sidecar')
    tree = parse(config)
    servers = [node for node in walk(tree) if node.words == ('server',) and node.opening is not None]
    candidates = []
    for server in servers:
        galleries = [node for node in walk(server.children)
                     if node.words[0] == 'location' and literal_path(node) in GALLERY_PATHS]
        if galleries:
            candidates.append((server, galleries))
    if len(candidates) != 1:
        raise ValueError('Expected exactly one server with the reviewed public gallery sidecar')
    server, galleries = candidates[0]
    if len(galleries) != 4 or {literal_path(node) for node in galleries} != GALLERY_PATHS:
        raise ValueError('Expected exactly four canonical public gallery sidecar locations')
    for node in galleries:
        path = literal_path(node)
        expected = f'http://127.0.0.1:{SIDECAR_PORT}'
        if path.startswith('/fashion-gallery/'):
            expected += '/api/public-media' + path
        proxies = [child.words for child in node.children if child.words[0] == 'proxy_pass']
        if (node not in server.children or node.words != ('location', '^~', path)
                or node.opening is None or any(child.opening is not None for child in node.children)
                or any(unsafe_directive(child) for child in node.children)
                or proxies != [('proxy_pass', expected)]):
            raise ValueError('Public gallery sidecar location differs from its canonical upstream')
    # Ancestor handlers can reroute a return 503 before Nginx sends it.
    for node in walk(tree):
        contains_server = node.start <= server.start and node.end >= server.end
        if contains_server and node is not server:
            for child in node.children:
                if child.words[0] != 'server' and unsafe_directive(child):
                    raise ValueError(f'Unreviewed inherited {child.words[0]} may bypass maintenance')
    for node in server.children:
        if unsafe_directive(node):
            raise ValueError(f'Unreviewed server {node.words[0]} may bypass maintenance')
        if node.words[0] in ('if', 'return'):
            raise ValueError('Unreviewed server rewrite-phase directive may bypass maintenance')
    locations = [node for node in walk(server.children) if node.words[0] == 'location']
    blocked = []
    owned_proxies = set()
    paths = []
    for node in locations:
        path = literal_path(node)
        if node in galleries:
            owned_proxies.update(child.start for child in walk(node.children) if child.words[0] == 'proxy_pass')
            continue
        if is_main_ingress(path):
            paths.append(selector(node))
            for child in walk(node.children):
                unsafe = unsafe_directive(child)
                if unsafe:
                    raise ValueError(f'Unreviewed API {unsafe} may bypass maintenance')
        proxies = [child for child in walk(node.children) if child.words[0] == 'proxy_pass']
        if any(not explicit_upstream(child) for child in proxies):
            raise ValueError('An unreviewed opaque proxy upstream may bypass maintenance')
        if any(proxy_port(child) == SIDECAR_PORT for child in proxies):
            raise ValueError('Unreviewed public gallery sidecar proxy outside canonical locations')
        main = [child for child in proxies if proxy_port(child) == api_port]
        if not main:
            continue
        if (not is_main_ingress(path) or node not in server.children or node.opening is None
                or any(child.opening is not None for child in node.children)
                or len(proxies) != 1 or main[0] not in node.children):
            raise ValueError('Unreviewed or nested main API proxy location; maintenance refused')
        blocked.append(node)
        owned_proxies.add(main[0].start)
    if len(paths) != len(set(paths)):
        raise ValueError('Duplicate API locations require manual review')
    for node in walk(server.children):
        if node.words[0] == 'proxy_pass' and proxy_port(node) == api_port and node.start not in owned_proxies:
            raise ValueError('Unreviewed main API proxy outside a direct API location')
    catchall = [node for node in blocked if node.words in (('location', '/api/'), ('location', '^~', '/api/'))]
    if len(catchall) != 1:
        raise ValueError('Expected one direct main API /api/ catchall')
    bare = [node for node in locations if literal_path(node) == '/api' and node.words[1:2] == ('=',)]
    if bare and bare[0] not in blocked:
        raise ValueError('Existing exact /api location is not a reviewed main API proxy')
    return server, galleries, blocked, not bare


def inspect(config: str, api_port: int) -> dict:
    """Describe the exact server and location selectors changed by prepare()."""
    server, galleries, blocked, add_bare = analyze(config, api_port)
    names = [word for node in server.children if node.words[0] == 'server_name' for word in node.words[1:]]
    return {'apiPort': api_port, 'serverNames': names,
            'blockedLocations': [selector(node) for node in blocked],
            'addedLocations': ['= /api'] if add_bare else [],
            'preservedGalleryLocations': sorted(literal_path(node) for node in galleries)}


def prepare(config: str, api_port: int) -> str:
    """Return maintenance config while preserving every non-main-API source span."""
    server, galleries, blocked, add_bare = analyze(config, api_port)
    newline = '\r\n' if '\r\n' in config else '\n'
    edits = []
    directives = ('add_header Retry-After "30" always;',
                  'add_header Cache-Control "no-store" always;', 'return 503;')
    for node in blocked:
        start_of_line = config.rfind('\n', 0, node.start) + 1
        indent = re.match(r'[ \t]*', config[start_of_line:node.start])[0]
        replacement = newline + ''.join(indent + '    ' + line + newline for line in directives) + indent
        edits.append((node.opening + 1, node.end - 1, replacement))
    if add_bare:
        marker = min(blocked, key=lambda node: node.start)
        start_of_line = config.rfind('\n', 0, marker.start) + 1
        indent = re.match(r'[ \t]*', config[start_of_line:marker.start])[0]
        addition = ('location = /api {' + newline
                    + ''.join(indent + '    ' + line + newline for line in directives)
                    + indent + '}' + newline + indent)
        edits.append((marker.start, marker.start, addition))
    updated = config
    for start, end, replacement in sorted(edits, reverse=True):
        updated = updated[:start] + replacement + updated[end:]
    for node in galleries:
        if config[node.start:node.end] not in updated:
            raise RuntimeError('Prepared maintenance changed a public gallery block')
    return updated


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--api-port', type=int, required=True)
    parser.add_argument('--inspect', action='store_true', help='Print the reviewed ingress blocklist as JSON.')
    args = parser.parse_args()
    with args.config.open(encoding='utf-8', newline='') as source:
        original = source.read()
    if args.inspect:
        print(json.dumps(inspect(original, args.api_port)))
    else:
        sys.stdout.write(prepare(original, args.api_port))
