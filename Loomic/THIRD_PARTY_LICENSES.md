# Third-party source notices

## Novanova Studio

The migration work references and may incorporate source code from
`Swayingleaves/novanova-studio`, licensed under GNU GPL v3.0.

- Source: https://github.com/Swayingleaves/novanova-studio
- Local checkout used for migration: `D:/qwq/项目/novanova-studio`
- License text: `D:/qwq/项目/novanova-studio/LICENSE`

Any file copied or materially derived from that project must retain the GPL
notice and this repository must remain distributable under GPL-3.0-compatible
terms. Files rewritten against Loomic APIs are marked in the migration ledger.

## image-to-slice

The editable image decomposition service is vendored from `50kg/image-to-slice`
at commit `402c20542f73e41f2393b6dfe3a5096c8c1a9521` under the MIT License.

- Source: https://github.com/50kg/image-to-slice
- Vendored path: `vendor/image-to-slice`
- License text: `vendor/image-to-slice/LICENSE`

Helstera exposes the decomposition workflow through its own authenticated API
and canvas UI. The upstream copyright and license are preserved in the vendored
directory.
