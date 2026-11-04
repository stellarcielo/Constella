#!/bin/sh
# Constella に取り込むために、Proxmox VE のクラスタの構成を JSON に書き出す(SPEC 4.7)。
# どれか 1 台のノードで、root として実行する。
#
#   sh proxmox-export.sh > constella-proxmox.json
#
# pvesh(Proxmox VE の API をコマンドで使う道具)で読むだけで、設定は変えない。
# パスワードやトークンも使わない。停止中のノードなど、読めなかったところは null にして続きを書き出し、
# 読めなかったことは標準エラーに出す。
#
# CONSTELLA_PVE_DIR は、テストで /etc/pve の代わりを渡すためのもの。

set -u

pve_dir=${CONSTELLA_PVE_DIR:-/etc/pve}

if ! command -v pvesh >/dev/null 2>&1; then
  echo "pvesh が見つかりません。Proxmox VE のノードで実行してください" >&2
  exit 1
fi
if [ ! -d "$pve_dir/nodes" ]; then
  echo "$pve_dir/nodes がありません。Proxmox VE のノードで実行してください" >&2
  exit 1
fi

# pvesh get の結果(JSON)を書く。読めなければ null
get() {
  if out=$(pvesh get "$1" --output-format json 2>/dev/null) && [ -n "$out" ]; then
    printf '%s' "$out"
  else
    echo "読めませんでした: $1" >&2
    printf 'null'
  fi
}

# SDN の設定は、適用済みのもの(running)を書く。読めなければ(古い Proxmox VE など)今の設定を書く
get_running() {
  if out=$(pvesh get "$1" --running 1 --output-format json 2>/dev/null) && [ -n "$out" ]; then
    printf '%s' "$out"
  else
    get "$1"
  fi
}

# Ceph の設定(ceph.conf)の値。ネットワークの一覧に使う文字だけを残す
ceph_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$pve_dir/ceph.conf" | head -n 1 |
    tr -cd '0-9A-Fa-f.:/, '
}

printf '{"format":"constella-proxmox","version":1'
printf ',"exported":"%s"' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf ',"host":"%s"' "$(hostname)"
printf ',"nodes":['
node_sep=''
for dir in "$pve_dir"/nodes/*/; do
  [ -d "$dir" ] || continue
  node=$(basename "$dir")
  printf '%s{"node":"%s","network":' "$node_sep" "$node"
  get "/nodes/$node/network"
  # ゲストの一覧は、クラスタで共有している設定ファイルの名前(VMID.conf)から取る
  for kind in qemu lxc; do
    if [ "$kind" = qemu ]; then conf_dir=qemu-server; else conf_dir=lxc; fi
    printf ',"%s":[' "$kind"
    guest_sep=''
    for file in "$dir$conf_dir"/*.conf; do
      [ -e "$file" ] || continue
      vmid=$(basename "$file" .conf)
      case $vmid in '' | *[!0-9]*) continue ;; esac
      printf '%s{"vmid":%s,"config":' "$guest_sep" "$vmid"
      get "/nodes/$node/$kind/$vmid/config"
      printf '}'
      guest_sep=','
    done
    printf ']'
  done
  printf '}'
  node_sep=','
done
printf ']'

# クラスタ(クラスタ名とノード、corosync のアドレス、移行のネットワーク)と Ceph のネットワーク
printf ',"cluster":{"status":'
get /cluster/status
printf ',"nodes":'
get /cluster/config/nodes
printf ',"options":'
get /cluster/options
printf ',"ceph":'
if [ -f "$pve_dir/ceph.conf" ]; then
  printf '{"public_network":"%s","cluster_network":"%s"}' \
    "$(ceph_value 'public[_ ]network')" "$(ceph_value 'cluster[_ ]network')"
else
  printf 'null'
fi
printf '}'

# SDN のゾーン・VNet と、VNet ごとのサブネット
printf ',"sdn":{"zones":'
get_running /cluster/sdn/zones
vnets=$(get_running /cluster/sdn/vnets)
printf ',"vnets":%s,"subnets":{' "$vnets"
subnet_sep=''
for vnet in $(printf '%s' "$vnets" | grep -o '"vnet": *"[A-Za-z0-9]*"' | sed 's/.*"\([A-Za-z0-9]*\)"$/\1/'); do
  printf '%s"%s":' "$subnet_sep" "$vnet"
  get_running "/cluster/sdn/vnets/$vnet/subnets"
  subnet_sep=','
done
printf '}}}\n'
