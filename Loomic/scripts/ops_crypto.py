"""Stream authenticated backup encryption; only the offline private key can restore it."""
import json
import os
from pathlib import Path
import struct
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b'HELSTERA-BACKUP-1\n'
CHUNK_BYTES = 4 * 1024 * 1024
TAG_BYTES = 16


def encrypt_backup(source: Path, target: Path, public_pem: bytes) -> None:
    key, nonce = os.urandom(32), os.urandom(12)
    public = serialization.load_pem_public_key(public_pem)
    wrapped = public.encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    header = json.dumps({'key': wrapped.hex(), 'nonce': nonce.hex()}, separators=(',', ':')).encode()
    prefix = MAGIC + struct.pack('>I', len(header)) + header
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(prefix)
    pending = target.with_suffix(target.suffix + '.partial')
    try:
        with source.open('rb') as incoming, pending.open('xb') as outgoing:
            os.chmod(pending, 0o600)
            outgoing.write(prefix)
            while chunk := incoming.read(CHUNK_BYTES):
                outgoing.write(encryptor.update(chunk))
            outgoing.write(encryptor.finalize())
            outgoing.write(encryptor.tag)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        os.replace(pending, target)
    finally:
        pending.unlink(missing_ok=True)


def decrypt_backup(source: Path, target: Path, private_pem: bytes) -> None:
    if target.exists():
        raise FileExistsError('Restore destination already exists')
    private = serialization.load_pem_private_key(private_pem, password=None)
    pending = target.with_suffix(target.suffix + '.partial')
    try:
        with source.open('rb') as incoming:
            prefix = incoming.read(len(MAGIC) + 4)
            if not prefix.startswith(MAGIC) or len(prefix) != len(MAGIC) + 4:
                raise ValueError('Backup encryption header is invalid')
            size = struct.unpack('>I', prefix[-4:])[0]
            if not 1 <= size <= 16384:
                raise ValueError('Backup encryption header is too large')
            header = incoming.read(size)
            metadata = json.loads(header)
            body_start = incoming.tell()
            remaining = source.stat().st_size - body_start - TAG_BYTES
            if remaining < 0:
                raise ValueError('Backup is truncated')
            incoming.seek(-TAG_BYTES, 2)
            tag = incoming.read(TAG_BYTES)
            incoming.seek(body_start)
            key = private.decrypt(bytes.fromhex(metadata['key']), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
            decryptor = Cipher(algorithms.AES(key), modes.GCM(bytes.fromhex(metadata['nonce']), tag)).decryptor()
            decryptor.authenticate_additional_data(prefix + header)
            with pending.open('xb') as outgoing:
                os.chmod(pending, 0o600)
                while remaining:
                    chunk = incoming.read(min(remaining, CHUNK_BYTES))
                    if not chunk:
                        raise ValueError('Backup is truncated')
                    remaining -= len(chunk)
                    outgoing.write(decryptor.update(chunk))
                outgoing.write(decryptor.finalize())
                outgoing.flush()
                os.fsync(outgoing.fileno())
        os.replace(pending, target)
    finally:
        pending.unlink(missing_ok=True)
