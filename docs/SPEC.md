# Constella 仕様書

> ネットワークトポロジ図の作成に特化したデスクトップアプリ。
> Packet Tracer のように「機器を置いて、ポートを選んでつなぐ」GUI と、
> 人や AI が書ける YAML 定義を双方向に同期する。

- バージョン: 0.1(MVP 設計)
- 最終更新: 2026-10-30

---

## 1. 目的とコンセプト

### 1.1 解決したい課題
- draw.io や Visio は汎用作図ツールなので、インターフェース名・ポートの使用状況・VLAN などを手で書き込む必要があり、間違いや更新漏れが起きやすい。
- 図がバイナリや独自形式だと Git で差分管理しづらく、AI に生成・編集させにくい。

### 1.2 コンセプト
1. **インターフェース中心**: 機器は「機種」を持ち、機種に応じたポートが自動で用意される。リンクは必ず「機器:ポート」同士を結ぶ。
2. **GUI とテキストの双方向同期**: GUI で編集すると YAML が更新され、YAML を編集すると図が更新される。
3. **AI フレンドリー**: YAML は接続関係だけ書けば図になる(座標は省略可能、自動レイアウト)。JSON Schema を公開する。

### 1.3 スコープ外(当面やらないこと)
- パケットの流れや ping などのシミュレーション(将来検討)
- 実機へのコンフィグ投入
- 複数人のリアルタイム共同編集

---

## 2. 対象プラットフォームと技術スタック

| 項目 | 採用技術 |
|---|---|
| 対象OS | **macOS を最初に完成させる**。Windows / Linux は後続で対応(同一コードベース) |
| アプリ基盤 | Tauri 2(Rust) |
| フロントエンド | TypeScript(strict)+ React + Vite |
| 図の描画 | React Flow(`@xyflow/react`) |
| 状態管理 | Zustand(+ Immer) |
| YAML 編集画面 | CodeMirror 6 |
| YAML パース/出力 | `yaml`(eemeli/yaml。コメント保持のため Document API を使う) |
| 自動レイアウト | elkjs |
| テスト | Vitest |
| 整形・静的解析 | ESLint + Prettier、Rust は rustfmt + clippy |

- 各ライブラリはプロジェクト作成時点の最新安定版を使う。
- Rust 側は最小限にする(ファイル入出力・ダイアログは Tauri 公式プラグイン `fs` / `dialog` を利用)。ロジックは基本的に TypeScript 側に置く。
- OS 固有の処理を書く場合は必ず抽象化し、Windows / Linux 対応を妨げないこと。
- macOS 版は、Apple Silicon・Intel の両方で動くユニバーサル版を、DMG で GitHub Releases に配布する。対応は macOS 13.3 以降。署名は簡易署名(ad-hoc。Apple の Developer ID による署名・公証はしない)。

---

## 3. 用語

| 用語 | 意味 |
|---|---|
| トポロジ | 1つの図。1ファイル = 1トポロジ |
| デバイス | 図に置く機器(ルーター、スイッチ、サーバーなど) |
| モデル(機種) | デバイスの種類定義。ポート一覧・役割・アイコンを持つテンプレート |
| インターフェース / ポート | デバイスが持つ接続口。本仕様では同義 |
| エンドポイント | `デバイスID:インターフェース名` の形式で表す接続端 |
| リンク | 2つのエンドポイントを結ぶ線 |
| ロール | デバイスの役割(router / l2switch / l3switch / firewall / server / hypervisor / pc / ap / cloud / generic) |
| ハイパーバイザ(ホスト) | VM やコンテナを動かす機器(Proxmox VE のノードなど)。ロールは hypervisor |
| ゲスト | ホストの上で動く VM(仮想マシン)またはコンテナ(Proxmox VE の LXC) |
| ブリッジ | ホストの中の仮想スイッチ(Proxmox VE の `vmbr0` など)。ゲストはブリッジにつなぐ |
| bond | 複数の NIC を 1 本に束ねたもの(リンクアグリゲーション) |
| VLAN インターフェース | 1 つの VLAN だけを扱う論理的な IF(`vmbr0.10` など) |
| クラスタ | 複数のホストをまとめて管理する単位(Proxmox VE のクラスタ) |
| SDN | クラスタ全体で仮想ネットワークを定義する仕組み(Proxmox VE の SDN。ゾーンと VNet) |

---

## 4. ファイル形式(トポロジ YAML)

### 4.1 基本
- 拡張子: `*.constella.yaml`
- 文字コード: UTF-8
- 先頭に形式バージョン `constella: 1` を必須とする。

### 4.2 例

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/stellarcielo/Constella/main/schema/constella.schema.json
constella: 1

meta:
  title: 自宅ラボ DC 区画
  description: 学習用ルーティング網

devices:
  rt1:
    model: generic-router-4
    label: Edge Router
  core-sw1:
    model: cisco-c2960-24tt-l
    interfaces:
      Gi0/1:
        description: to rt1
  srv1:
    model: generic-server-2
  isp:
    role: cloud            # model 省略 = フレキシブル(任意のIF名を使える)

links:
  - a: rt1:Gi0/0
    b: isp:wan
  - a: rt1:Gi0/1
    b: core-sw1:Gi0/1
  - a: core-sw1:Fa0/1
    b: srv1:eth0
    label: mgmt

layout:
  rt1: { x: 300, y: 80 }
  core-sw1: { x: 300, y: 240 }
  # 座標が無いデバイスは自動レイアウトで配置する
```

### 4.3 各セクションの定義

#### `devices`(マップ。キー = デバイスID)
| フィールド | 必須 | 説明 |
|---|---|---|
| `model` | 任意 | モデルID。省略時はフレキシブルデバイス |
| `role` | 任意 | 省略時はモデルの role。モデルも無い場合は `generic` |
| `label` | 任意 | 図に表示する名前。省略時はデバイスID |
| `host` | 任意 | ゲストのとき、動いているホストのデバイスID(4.6) |
| `guest` | 任意 | `vm` / `container`。省略時はモデルの guest。どちらも無く `host` があれば `vm`(4.6) |
| `vmid` | 任意 | Proxmox VE の VMID(100〜999999999 の整数) |
| `interfaces` | 任意 | インターフェースごとの追加情報(下記) |

デバイスID の規則: `^[A-Za-z0-9][A-Za-z0-9._-]*$`(`:` は使用不可)

`interfaces.<IF名>` に書ける項目(MVP では保存・表示のみ。図への反映はフェーズ3以降):
- `description`: 文字列
- `ip`: 文字列の配列(例: `["192.0.2.1/30", "2001:db8::1/64"]`)
- `mode`: `access` / `trunk` / `routed`
- `vlan`: access の場合の VLAN ID。ゲストの IF では VLAN タグ(Proxmox VE の `tag`)、VLAN インターフェースではその VLAN ID
- `vlans`: trunk の場合の許可 VLAN(例: `"10,20,100-110"`)。ゲストの IF では Proxmox VE の `trunks`、VLAN aware なブリッジでは通す VLAN(Proxmox VE の `bridge-vids`。省略時は `2-4094`)

論理的な IF(bond・ブリッジ・VLAN インターフェース。4.6)に書ける項目:
- `type`: `bond` / `bridge` / `vlan`。省略時は物理的な IF(ポート)。`type` を書いた IF は、モデルに無い名前でも使える
- `members`: bond で束ねる IF、ブリッジにつなぐ IF(Proxmox VE の `bond-slaves` / `bridge-ports`)。同じデバイスの IF 名の配列
- `bond-mode`: bond のモード(`balance-rr` / `active-backup` / `balance-xor` / `broadcast` / `802.3ad` / `balance-tlb` / `balance-alb`)
- `vlan-aware`: ブリッジが VLAN aware(VLAN を区別して通す)か。`true` / `false`、省略時は `false`
- `vlan-raw-device`: VLAN インターフェースの親の IF
- VLAN インターフェースの `vlan` と `vlan-raw-device` は、名前が `親.VLAN ID`(`vmbr0.10`)なら省略できる。名前が `vlan10` の形なら `vlan` を省略できる

#### `links`(配列)
| フィールド | 必須 | 説明 |
|---|---|---|
| `a` | 必須 | エンドポイント `デバイスID:IF名` |
| `b` | 必須 | エンドポイント |
| `media` | 任意 | `copper` / `fiber` / `dac` / `wireless` / `virtual`。省略時はポート種別から推定(ブリッジとのリンクは `virtual`) |
| `label` | 任意 | リンク中央に表示する文字 |

- エンドポイントは **最初の `:`** でデバイスIDとIF名に分割する。
- `a` と `b` の順序に意味はない。
- ゲストの IF とホストのブリッジを結ぶリンクも書く(`a: web01:net0`、`b: pve1:vmbr0`。4.6)。ブリッジには何本でもつなげる。

#### `layout`(マップ。キー = デバイスID、またはブリッジの `ホストのデバイスID:ブリッジ名`)
- `{ x: number, y: number }`。GUI でデバイスを動かすと自動更新される。
- ブリッジ(4.6)の位置は `pve1:vmbr0: { x: 300, y: 520 }` のように書く。
- 任意で `_viewport: { x, y, zoom }` を保存してよい。

#### `groups`(配列)
```yaml
groups:
  - id: rack1
    kind: rack          # site / rack / vlan / subnet / as / cluster / custom
    label: Rack 1
    members: [rt1, core-sw1]
```
- `kind: cluster` のグループは、クラスタのネットワーク `networks` を持てる(4.6)。

#### `sdn`(マップ。4.6)
- `zones`: SDN のゾーン(キー = ゾーンID)
- `vnets`: SDN の VNet(キー = VNet ID)

### 4.4 インターフェース名の正規化
- Cisco 系の長い名前と短い名前を同一視する。
  例: `GigabitEthernet0/1` = `Gi0/1`、`TenGigabitEthernet1/0/1` = `Te1/0/1`
- 略称テーブル(初期): `Ethernet→Eth`, `FastEthernet→Fa`, `GigabitEthernet→Gi`, `TenGigabitEthernet→Te`, `TwentyFiveGigE→Twe`, `FortyGigabitEthernet→Fo`, `HundredGigE→Hu`, `Port-channel→Po`, `Vlan→Vl`, `Loopback→Lo`, `Serial→Se`, `Management→Mgmt`
- 大文字小文字は区別しない。
- **YAML 読み込み時はどちらでも受け付け、保存時は短縮形に統一**する。

### 4.5 バリデーション
読み込み・編集のたびに検証し、結果を「問題パネル」に一覧表示する。

| レベル | 内容 | 扱い |
|---|---|---|
| エラー(パース) | YAML 構文エラー、`constella` バージョン不正 | 図は直前の正常状態のまま。エディタ上に赤線表示 |
| エラー(意味) | 存在しないデバイス/IF への参照、同一ポートの二重使用、デバイスID重複、未知のモデル | 図には反映するが、該当リンク/デバイスを赤で強調 |
| 警告 | ポート種別の不一致(例: RJ45 と SFP)、自分自身への接続 | 黄色で強調 |

- フレキシブルデバイス(model 無し、または `flexible: true` のモデル)は、未定義の IF 名を参照されたら自動でその IF を持っているものとして扱う。
- ハイパーバイザまわり(ゲスト・ブリッジ・bond・VLAN インターフェース・クラスタ・SDN)の検証は 4.6 を参照。

### 4.6 ハイパーバイザ(仮想化基盤)
Proxmox VE のような仮想化基盤を描くための書き方。キーや IF の名前は Proxmox VE に合わせるが、ほかのハイパーバイザにも使える汎用の形にする。

```yaml
devices:
  core-sw1:
    model: generic-l2switch-24
    interfaces:
      Gi0/1: { mode: trunk, vlans: "10,20,40" }
      Gi0/2: { mode: trunk, vlans: "10,20,40" }
  pve1:
    model: generic-hypervisor-4      # ロールは hypervisor。物理的な NIC は eno1〜eno4
    interfaces:
      bond0:    { type: bond, members: [eno1, eno2], bond-mode: 802.3ad }
      vmbr0:    { type: bridge, members: [bond0], vlan-aware: true }
      vmbr0.10: { type: vlan, ip: [192.168.10.2/24] }   # ホストの管理用の IP
  web01:
    model: generic-vm                # guest: vm
    host: pve1                       # pve1 の上で動く
    vmid: 100
    interfaces:
      net0: { vlan: 10, ip: [192.168.10.11/24] }       # vlan = Proxmox VE の tag
  fw01:
    model: generic-vm
    role: firewall                   # ロール(機能)は今までどおり。OPNsense の VM なら firewall
    host: pve1
    vmid: 101
    interfaces:
      net0: { mode: trunk, vlans: "10,20" }             # Proxmox VE の trunks
  db01:
    model: generic-container         # guest: container(Proxmox VE の LXC)
    host: pve1
    vmid: 200
    interfaces:
      net0: { vlan: 20 }

links:
  - a: pve1:eno1                     # 物理的な配線は今までどおり
    b: core-sw1:Gi0/1
  - a: pve1:eno2
    b: core-sw1:Gi0/2
  - a: web01:net0                    # ゲストはブリッジにつなぐ
    b: pve1:vmbr0
  - a: fw01:net0
    b: pve1:vmbr0
  - a: db01:net0
    b: pve1:vmbr0

layout:
  pve1:vmbr0: { x: 300, y: 520 }     # ブリッジの位置は「ホスト:ブリッジ」で覚える

groups:
  - id: lab
    kind: cluster
    members: [pve1, pve2, pve3]      # pve2・pve3 の定義は省略
    networks:                        # クラスタのネットワーク(名前: サブネット)
      corosync: 10.10.0.0/24
      ceph-public: 10.20.0.0/24
      migration: 10.30.0.0/24

sdn:
  zones:
    vlanzone: { type: vlan, bridge: vmbr0 }    # nodes を省略 = ロールが hypervisor の機器すべて
  vnets:
    vnet40: { zone: vlanzone, tag: 40, subnets: [10.40.0.0/24] }   # 各ホストに vnet40 ができる
```

#### ホストとゲスト
- ホストは、ふつうはロールが hypervisor の機器(組み込みモデル `generic-hypervisor-4` など)。ほかのロールの機器(コンテナを動かすサーバーなど)もホストにできる。
- ゲストは、`host` に動いているホストのデバイスIDを書いた機器。
  - VM かコンテナかは `guest`(`vm` / `container`)で表す。省略時はモデルの `guest`、それも無ければ `vm`。
  - `guest` があって `host` が無い機器は、図に描かないホストの上のゲストとして扱う(クラウドの VM など)。
  - ロールは、ゲストでも機能を表す(OPNsense の VM なら firewall)。
- ゲストの上でさらにゲストを動かす(入れ子の仮想化)こともできる。

#### ホストの中のネットワーク
- bond・ブリッジ・VLAN インターフェースは、ホストの `interfaces` に `type` を付けて書く(Linux や Proxmox VE の `/etc/network/interfaces` と同じ考え方)。
- bond の `members` には物理的な IF を、ブリッジの `members` には物理的な IF・bond・VLAN インターフェースを書く。`members` の無いブリッジは、ホストの中だけのネットワークになる。
- ホストの IP は、ブリッジや VLAN インターフェースの `ip` に書く。
- リンクをつなぐのは、物理的な IF とブリッジだけ。bond・VLAN インターフェースにはつながない(束ねた線は、メンバーの物理的な IF ごとに書く)。

#### ゲストとブリッジのつなぎ方
- `links` に、ゲストの IF とホストのブリッジを結ぶリンクを書く。ブリッジにつなげるのは、そのホストの上で動くゲストの IF だけ。
- VLAN タグはゲストの IF の `vlan` に、トランク(複数の VLAN を通す)は `mode: trunk` と `vlans` に書く。

#### クラスタ
- `groups` に `kind: cluster` のグループを書き、`members` にホストを並べる。
- `networks` に、クラスタのネットワークの名前とサブネットを書く。名前は自由(`corosync`・`ceph-public`・`ceph-cluster`・`migration` など)。
- IP がそのサブネットに入る IF には、ラベルにネットワークの名前を出す。

#### SDN
- 最上位の `sdn` に、ゾーン(`zones`)と VNet(`vnets`)を書く。
- ゾーンに書ける項目:
  - `type`(必須): `simple` / `vlan` / `qinq` / `vxlan` / `evpn`
  - `bridge`: vlan・qinq のときに使う、各ホストのブリッジ
  - `tag`: qinq の外側の VLAN ID
  - `nodes`: ゾーンを使うホストのデバイスID。省略時は、ロールが hypervisor の機器すべて
- VNet に書ける項目:
  - `zone`(必須): ゾーンID
  - `tag`: VLAN ID(vxlan・evpn では VNI)。simple 以外では必須
  - `subnets`: サブネットの配列
- VNet は、ゾーンの各ホストの中のブリッジとして扱う。ゲストは `pve1:vnet40` につなぎ、位置も `pve1:vnet40` で覚える。

#### Proxmox VE との対応
| Proxmox VE | Constella |
|---|---|
| ノード | ロールが hypervisor の機器 |
| VM(qemu)/ CT(lxc) | `guest: vm` / `guest: container` の機器。`host` にノード、`vmid` に VMID |
| ゲストの NIC(`net0`)の `bridge=vmbr0` | リンク `web01:net0` ↔ `pve1:vmbr0` |
| ゲストの NIC の `tag=10` | IF `net0` の `vlan: 10` |
| ゲストの NIC の `trunks=20;30` | IF `net0` の `mode: trunk`、`vlans: "20,30"` |
| `bond-slaves` / `bond-mode` | `type: bond` の IF の `members` / `bond-mode` |
| `bridge-ports` / `bridge-vlan-aware` / `bridge-vids` | `type: bridge` の IF の `members` / `vlan-aware` / `vlans` |
| `vmbr0.10`、`vlan-raw-device` | `type: vlan` の IF、`vlan-raw-device` |
| クラスタ、corosync・Ceph・移行(migration)のネットワーク | `kind: cluster` のグループ、`networks` |
| SDN のゾーン・VNet | `sdn` の `zones`・`vnets` |

#### 検証(4.5 に加える)
| レベル | 内容 |
|---|---|
| エラー | `host` のデバイスが無い。`host` をたどると輪になる(自分自身を含む) |
| エラー | VMID の重複(同じホストの中。ホストがクラスタに入っていれば、クラスタの中) |
| エラー | `members` の IF が無い。1 つの IF が 2 つの bond・ブリッジに入っている |
| エラー | ブリッジに、そのホストの上で動くゲスト以外の IF がつながっている。bond・VLAN インターフェースにリンクがつながっている |
| エラー | SDN: 参照先(ホスト・ゾーン)が無い。ゾーンのホストに `bridge` が無い。ゾーンに入っていないホストで VNet を使っている。VNet の `tag` が無い(simple 以外)。VNet ID がホストの IF 名と重なる |
| 警告 | VLAN の通り道(下記)で、通らない VLAN がある |
| 警告 | クラスタのホストに、`networks` のサブネットに入る IP が無い |
| 警告 | VNet ID が 8 文字より長い(Proxmox VE の制限) |

VLAN の通り道(最初のスイッチまでを確かめる):
- 対象は、ゲストの IF のタグ(`vlan`)とトランクの `vlans`、ホストの VLAN インターフェースの VLAN、vlan ゾーンの VNet の `tag`。
- ブリッジが VLAN aware なら、ブリッジの `vlans`(省略時は `2-4094`)に入っているか。
- ブリッジの `members` から bond をたどって物理的な IF へ進み、その IF につながるスイッチのポートで通るか。trunk なら `vlans`(省略時はすべて通す)に入っているか。access なら、タグの付いた VLAN は通らない。`mode` が書かれていなければ確かめない。

---

## 5. モデル(機種)ライブラリ

### 5.1 モデル定義ファイル形式

```yaml
id: cisco-c2960-24tt-l
vendor: Cisco
name: Catalyst 2960-24TT-L
role: l2switch
ports:
  - name: "FastEthernet0/{1-24}"
    type: rj45
    speed: 100M
  - name: "GigabitEthernet0/{1-2}"
    type: rj45
    speed: 1G
```

- `name` の `{開始-終了}` は連番展開する(1つの name に複数書くことも許可。例: `Gi1/{0-1}/{1-4}`)。
- `type`: `rj45` / `sfp` / `sfp+` / `sfp28` / `qsfp+` / `qsfp28` / `console` / `serial` / `wireless` / `virtual`
- `speed`: 表示用の文字列(`100M` / `1G` / `10G` / `25G` / `40G` / `100G` など)
- `flexible: true` を指定すると、定義外の IF 名も使用可能になる。
- `guest: vm` / `guest: container` を指定すると、そのモデルの機器はゲスト(4.6)になる。
- 必要に応じて `icon` でアイコンを上書きできる(既定は role ごとのアイコン)。

### 5.2 モデルの置き場所
1. **組み込みモデル**: アプリ同梱(`src/library/models/*.yaml`)
2. **ユーザーモデル**: OS ごとのアプリデータディレクトリ配下の `models/`(macOS では `~/Library/Application Support/Constella/models/`)。Tauri のパス API で取得すること。
3. 同じ id があればユーザーモデルを優先する。

### 5.3 MVP で同梱するモデル
汎用モデル(ポート名は Cisco 風に統一):
- `generic-router-4`(Gi0/0〜Gi0/3、rj45)
- `generic-l2switch-24`(Gi0/1〜Gi0/24 rj45 + Te0/25〜Te0/28 sfp+)
- `generic-l3switch-48`(Gi1/0/1〜Gi1/0/48 rj45 + Te1/1/1〜Te1/1/4 sfp+)
- `generic-firewall-8`(port1〜port8、rj45)
- `generic-server-2`(eth0〜eth1)
- `generic-pc`(eth0)
- `generic-ap`(eth0, wlan0)
- `generic-cloud`(flexible)

仮想化のモデル(フェーズ4で追加。4.6):
- `generic-hypervisor-4`(eno1〜eno4、rj45。role: hypervisor)
- `generic-vm`(net0〜net3、virtual、flexible。role: server、guest: vm)
- `generic-container`(net0〜net3、virtual、flexible。role: server、guest: container)

実機モデル(例として1つ):
- `cisco-c2960-24tt-l`(上記 5.1 の定義)

実機モデルは後からユーザーが追加していく前提。実機モデルを追加する場合はポート構成を公式資料で確認すること。

---

## 6. 画面構成

```
┌──────────────────────────────────────────────────────────────┐
│ ツールバー: 新規 開く 保存 | 選択 接続 | 自動整列 | YAML表示切替 │
├──────────┬───────────────────────────────┬──────────────────┤
│ パレット │                               │ インスペクタ      │
│          │        キャンバス               │ (選択中の        │
│ 検索欄    │       (React Flow)            │  デバイス/リンク) │
│ ロール別  │                               │                  │
│ モデル一覧 │                               ├──────────────────┤
│          │                               │ YAMLエディタ      │
│          │                               │ (表示切替可)      │
├──────────┴───────────────────────────────┴──────────────────┤
│ ステータスバー: ファイル名 / 未保存マーク / エラー n 件 警告 n 件  │
└──────────────────────────────────────────────────────────────┘
```

- YAML エディタは右側の下段に置き、ツールバーで表示/非表示を切り替える。将来的に「キャンバスとYAMLを左右半々」レイアウトにも切り替えられる構造にしておく。
- 問題パネルはステータスバーの件数をクリックすると開く。項目クリックで該当デバイス/リンク、および YAML の該当行へジャンプ。
- macOS の標準メニューバー(ファイル/編集/表示/ウィンドウ/ヘルプ)と標準ショートカット(⌘N, ⌘O, ⌘S, ⇧⌘S, ⌘Z, ⇧⌘Z, ⌘C, ⌘V, ⌘A, Delete)に対応する。

---

## 7. 操作仕様

### 7.1 デバイスの配置
- パレットからキャンバスへドラッグ&ドロップで配置。
- パレットのモデルは role ごとにまとめ、ゲストのモデル(`guest` のあるモデル)は「ゲスト(VM・コンテナ)」にまとめる。インスペクタのモデル一覧も同じ。
- VM・コンテナのモデルを置くとき(4.6):
  - ハイパーバイザ(またはゲストのいるホスト)の上に落とすと、そのホストのゲストになり、ホストの下に並ぶ(同じホストのゲストがいれば、その右)。
  - ホストの枠の中に落とすと、その枠のホストのゲストになる(落とした位置に置く)。
  - それ以外の所に落とすと、`host` なし。
  - 置いたあとにドラッグしても、ホストは変わらない(インスペクタで変える)。
- デバイスIDは role ごとのプレフィックス + 連番で自動採番(`rt1`, `sw1`, `l3sw1`, `fw1`, `srv1`, `hv1`, `pc1`, `ap1`, `cloud1`)。ゲストは role ではなく種類で採番する(`vm1`, `ct1`)。
- インスペクタでデバイスID・ラベル・モデルを変更できる。ゲストなら、種類・ホスト・VMID も変更できる。
  - **デバイスIDを変更したら、関連するリンク・layout・groups の参照もすべて書き換える**(ゲストの `host`、ブリッジの位置のキー、SDN の `nodes` も含む)。
  - モデルを変更して既存リンクのポートが存在しなくなる場合は確認ダイアログを出す。

### 7.2 接続(Packet Tracer 風)
1. ツールバーで「接続」モードにする(ショートカット: `C`)。
2. デバイスAをクリック → **ポート選択ポップアップ**が開く。
3. ポートを選ぶ → デバイスBをクリック → ポート選択ポップアップ → リンク作成。
4. Esc でキャンセル。

ポート選択ポップアップ:
- ポート種別ごとにグループ表示(RJ45 / SFP+ …)。
- 使用中ポートはグレーアウトし、接続先(`core-sw1:Gi0/1` など)を併記。選択不可。
- 一覧上部に検索欄。
- 「次の空きポート」ボタン(先頭の未使用ポートを選択)。
- フレキシブルデバイスの場合は IF 名を自由入力できる。
- 相手側ポートと種別が合わない場合は警告アイコンを表示(接続自体は許可)。

### 7.3 リンクの表示
- デバイスの中心同士を直線で結ぶ「フローティングエッジ」方式で描画する(ポート数が多いため、デバイス上に接続点ハンドルは表示しない)。
- **リンク両端のデバイス寄りの位置にIF名(短縮形)を表示**する。ラベルは線に重ならないよう小さな背景付きで描く。
- IF に IP・VLAN が書かれていれば、IF 名ラベルの下に 1 行ずつ表示する(IP は 1 つずつ、access は `VLAN 10`、trunk は `trunk 10,20,30`)。
- 同じデバイス間に複数リンクがある場合(LAG など)は、線を少しずつずらして重ならないようにする。
- media による線のスタイル: copper=実線(グレー系)、fiber=実線(オレンジ系)、dac=実線(青系)、wireless=破線、virtual=点線。
- ハイパーバイザ(4.6)の表示:
  - ホストは枠で囲み、中にブリッジとゲストを置く。グループの枠は、メンバーのホストの枠を丸ごと囲む。
  - ホストの枠のラベルは、直接のゲストの数(`VM 2・CT 1`)。クリックすると、ホストとゲストをまとめて選ぶ。
  - ホストの枠は「グループ」の表示とは別に、ゲストを表示しているときに出す。
  - ゲストのアイコンには `VM` / `CT` の印を付ける。
  - ブリッジ(SDN の VNet を含む)は小さな箱で描き、ホストとの間に線を引く。線のホスト側には、ブリッジのメンバー(bond0 など。bond なら束ねた NIC も)を出す。ブリッジ側の端には IF 名を出さない(箱に名前があるため)。
  - クラスタのネットワークに入る IF は、IP の行にネットワークの名前(`corosync` など)を添える。
- 表示オプション: IF名ラベル・IP・VLAN・ゲスト(VM・コンテナ・ブリッジ)それぞれの表示/非表示、長い名前/短縮形の切り替え。
- 表示レイヤー(すべて / L1 / L2 / L3)で、ラベルの行とグループの枠をまとめて切り替える。
  - L1: IF 名と、拠点・ラックの枠。ゲストとブリッジは隠す
  - L2: IF 名と VLAN、VLAN の枠
  - L3: IF 名と IP、サブネット・AS の枠
  - 種類なし・custom・cluster の枠は、どのレイヤーでも表示する。
  - レイヤーを選んだあとも、個々の表示オプションで調整できる。
  - ショートカットは ⌘0(すべて)、⌘1〜⌘3(L1〜L3)。

### 7.4 編集操作
- 選択・複数選択(ドラッグ範囲選択、⇧クリック)・移動・削除。
- デバイス削除時は接続していたリンクも削除する。
  - ホストを削除しても、ゲストは残して `host` を外す(ホストとゲストをまとめて消すときは、ホストの枠のラベルをクリックして選ぶ)。
- コピー&ペースト: 選択デバイスと、選択内で完結するリンクを複製。デバイスIDは自動で再採番。
  - ゲストの `host` は、ホストも一緒に複製したなら新しいホストに、そうでなければ元のまま(図に無いホストなら外す)。
- Undo/Redo: すべての編集(GUI・YAML の両方)を対象にする。YAML エディタでの編集は、反映の単位(後述のデバウンス後)で1ステップとする。

---

## 8. GUI ⇔ YAML 同期

### 8.1 データの流れ
- 唯一の正(Single Source of Truth)は**メモリ上のトポロジモデル**(Zustand ストア)。
- GUI 操作 → モデル更新 → YAML 文字列を再生成 → エディタに反映。
- YAML 編集 → 300ms デバウンス → パース → 検証 → モデル更新 → キャンバス再描画。
- 更新の発生元(`gui` / `yaml` / `file`)をタグ付けし、更新のループや、入力中のエディタ内容が上書きされることを防ぐ。

### 8.2 YAML 出力のルール
- ユーザーが書いたコメント・キー順は**可能な限り保持**する(`yaml` の Document API で、既存ドキュメントに差分を当てる形で更新する)。
- 新規要素は末尾に追加する。
- IF 名は短縮形で出力する。
- `layout` は GUI でデバイスを動かしたときに更新する(ドラッグ中は更新せず、ドロップ時に1回)。

### 8.3 パースエラー時
- キャンバスは直前の正常なモデルを表示し続ける。
- エディタ上の該当行に赤線とエラーメッセージ。
- この状態で GUI 操作をした場合は、確認ダイアログ(「YAML にエラーがあります。GUI の内容で上書きしますか?」)を出す。

---

## 9. 自動レイアウト
- elkjs の layered アルゴリズムを使用(上から下へ: cloud → router/firewall → l3switch → l2switch → server/hypervisor/pc/ap の順になるよう、role でレイヤーのヒントを与える)。
- ゲストは、ホストの枠の中にまとめて並べる(上からホスト・ブリッジ・ゲストの順)。ホストとゲストのかたまりは、ホストの段に置く。
- ファイル読み込み時、`layout` に座標が無いデバイスだけを自動配置する(既存の座標は動かさない)。
  - ホストに座標があるゲストは、ホストの下に並べる(同じホストのゲストがいれば、いちばん下の段の右に続ける)。ほかの機器と重なったときは「自動整列」で直す。
- ツールバーの「自動整列」で全デバイスを再配置(Undo 可能)。

---

## 10. ファイル操作
- 新規 / 開く / 保存 / 名前を付けて保存。
- 未保存の変更がある場合はタイトルとステータスバーに表示し、閉じる・新規・開く操作の前に確認する。
- 最近使ったファイル(最大10件)をメニューに表示。
- 新規作成したファイルの先頭には、JSON Schema のコメント行(11章)を入れる。
- ファイルを外部で変更された場合の検知はフェーズ2以降。

---

## 11. AI・外部ツール向け
- `schema/constella.schema.json`(JSON Schema)をリポジトリに置き、トポロジ YAML の仕様を機械可読にする。
  - 公開 URL: `https://raw.githubusercontent.com/stellarcielo/Constella/main/schema/constella.schema.json`
  - ファイルの先頭に `# yaml-language-server: $schema=<公開 URL>` を書くと、対応エディタ(VS Code の YAML 拡張機能など)で補完と検証が効く。
- `examples/` にサンプルトポロジを数個置く(小規模ラボ、2層スイッチ網、冗長構成+LAG、Proxmox VE)。
- 将来: CLI(`constella validate <file>` / `constella render <file> -o out.svg`)と MCP サーバーを提供し、AI から直接検証・描画できるようにする。そのため、**モデル・パース・検証・レイアウトのロジックは React に依存しない純粋な TypeScript モジュールとして分離**しておくこと。

---

## 12. フェーズ計画と完了条件

### フェーズ1: MVP
- [x] Tauri 2 + React + Vite のプロジェクト雛形、macOS でビルド・起動できる
- [x] トポロジモデルの型定義、YAML パース/出力、IF 名正規化、バリデーション(Vitest でテスト)
- [x] 組み込みモデルライブラリの読み込みとポート連番展開
- [x] パレットからのデバイス配置、移動、削除
- [x] ポート選択ポップアップによる接続
- [x] フローティングエッジ + 両端 IF 名ラベル + 並列リンクのずらし表示
- [x] インスペクタ(デバイスID/ラベル/モデル/IF一覧と使用状況、リンクの media/label)
- [x] ファイルの新規/開く/保存
- [x] 問題パネル

**完了条件**: 4.2 の例と同等のトポロジを GUI だけで作成して保存でき、保存した YAML を開き直すと同じ図が再現される。

### フェーズ2: 双方向同期とレイアウト
- [x] YAML エディタ(CodeMirror)とのリアルタイム双方向同期(コメント保持)
- [x] Undo/Redo、コピー&ペースト
- [x] elkjs による自動レイアウト
- [x] SVG / PNG エクスポート
- [x] JSON Schema と examples の整備
- [x] 最近使ったファイル(最大10件)をメニューに表示
- [x] 問題パネルの項目から YAML エディタの該当行へジャンプ

**完了条件**: YAML だけを手書き(座標なし)して開くと自動配置された図になり、GUI で動かすとコメントを残したまま YAML の layout が更新される。

### フェーズ3: ネットワーク情報の可視化
- [x] グループ(site / rack / vlan / subnet / as)の枠表示
- [x] IF の IP / VLAN 情報をラベルに表示
- [x] L1 / L2 / L3 表示切り替え
- [x] ユーザーモデルの追加 UI

### フェーズ4以降(候補)
- [x] macOS 版の配布準備(簡易署名・ユニバーサル版・アイコン・GitHub Releases)
- ハイパーバイザ(Proxmox VE など)の対応(4.6)
  - [x] 4-1 ゲストとホストの枠(role hypervisor、`host`・`guest`・`vmid`、仮想化の組み込みモデル、ホストの枠、自動レイアウト、表示オプション「ゲスト」)
  - [ ] 4-2 ブリッジ(`type: bridge`、ブリッジの箱、ゲストとのリンク、ブリッジの位置の保存)
  - [ ] 4-3 bond・VLAN インターフェース(`type: bond` / `vlan`、ラベル)
  - [ ] 4-4 VLAN の通り道の検証
  - [ ] 4-5 クラスタ(`kind: cluster`、`networks`)
  - [ ] 4-6 SDN(ゾーン・VNet)
- Proxmox VE からの取り込み(API または設定ファイル)
- Windows / Linux ビルドとインストーラ
- CLI / MCP サーバー
- LLDP / SNMP からの取り込み、containerlab / NetBox との連携
- シミュレーション機能

---

## 13. ディレクトリ構成(案)

```
constella/
├── CLAUDE.md
├── docs/
│   └── SPEC.md
├── schema/
│   └── constella.schema.json
├── examples/
├── src-tauri/                 # Rust(最小限)
└── src/
    ├── core/                  # React 非依存の純粋ロジック
    │   ├── types.ts
    │   ├── parse.ts           # YAML → モデル
    │   ├── serialize.ts       # モデル → YAML(Document 差分更新)
    │   ├── validate.ts
    │   ├── ifname.ts          # IF 名の正規化・略称
    │   ├── portExpand.ts      # {1-24} の連番展開
    │   └── layout.ts          # elkjs ラッパ
    ├── library/
    │   └── models/            # 組み込みモデル YAML
    ├── store/                 # Zustand ストア、Undo 履歴
    ├── components/
    │   ├── Canvas/            # React Flow、カスタムノード/エッジ
    │   ├── Palette/
    │   ├── Inspector/
    │   ├── PortPicker/
    │   ├── YamlEditor/
    │   ├── ProblemsPanel/
    │   └── Toolbar/
    ├── icons/                 # ロール別アイコン(オリジナル SVG)
    └── platform/              # Tauri API の薄いラッパ(OS 差分をここに閉じ込める)
```

- アイコンはオリジナルのシンプルな SVG を用意する。他社のアイコンセットはライセンス確認が必要なため同梱しない。

---

## 14. テスト方針
- `src/core/` は Vitest で単体テストを書く(パース、出力、IF 名正規化、連番展開、バリデーション、コメント保持)。
- 往復テスト: `examples/` の各ファイルを「読み込み → 出力」して意味的に同一であることを確認する。
- UI は各フェーズの完了条件を手動確認チェックリストで確認する。
