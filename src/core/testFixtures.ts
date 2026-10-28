// テスト用の小さなモデル一覧とサンプル YAML。

import type { DeviceModel, ModelCatalog, PortDef, PortType } from "./types";

function range(prefix: string, from: number, to: number, type: PortType): PortDef[] {
  const ports: PortDef[] = [];
  for (let i = from; i <= to; i++) ports.push({ name: `${prefix}${i}`, type });
  return ports;
}

const models: DeviceModel[] = [
  { id: "generic-router-4", role: "router", flexible: false, ports: range("Gi0/", 0, 3, "rj45") },
  {
    id: "generic-l2switch-24",
    role: "l2switch",
    flexible: false,
    ports: [...range("Gi0/", 1, 24, "rj45"), ...range("Te0/", 25, 28, "sfp+")],
  },
  {
    id: "cisco-c2960-24tt-l",
    vendor: "Cisco",
    name: "Catalyst 2960-24TT-L",
    role: "l2switch",
    flexible: false,
    ports: [...range("FastEthernet0/", 1, 24, "rj45"), ...range("GigabitEthernet0/", 1, 2, "rj45")],
  },
  { id: "generic-server-2", role: "server", flexible: false, ports: range("eth", 0, 1, "rj45") },
  { id: "generic-cloud", role: "cloud", flexible: true, ports: [] },
];

export const testCatalog: ModelCatalog = new Map(models.map((m) => [m.id, m]));

/** SPEC 4.2 の例 */
export const specExample = `# yaml-language-server: $schema=https://raw.githubusercontent.com/stellarcielo/Constella/main/schema/constella.schema.json
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
`;
