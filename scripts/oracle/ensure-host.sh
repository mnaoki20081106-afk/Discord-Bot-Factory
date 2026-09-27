#!/usr/bin/env bash
set -euo pipefail

: "${OCI_TENANCY_OCID:?OCI_TENANCY_OCID is required}"
: "${OCI_COMPARTMENT_OCID:?OCI_COMPARTMENT_OCID is required}"
: "${BOT_FACTORY_SSH_PRIVATE_KEY:?BOT_FACTORY_SSH_PRIVATE_KEY is required}"

PREFIX="${BOT_FACTORY_OCI_PREFIX:-discord-bot-factory}"
VCN_NAME="$PREFIX-vcn"
SUBNET_NAME="$PREFIX-subnet"
IGW_NAME="$PREFIX-igw"
INSTANCE_NAME="$PREFIX-host"
VCN_CIDR="10.42.0.0/16"
SUBNET_CIDR="10.42.0.0/24"

id_by_name() {
  local json="$1" name="$2"
  jq -r --arg n "$name"     '.data[]? | select(."display-name"==$n and (."lifecycle-state" // "AVAILABLE") != "TERMINATED") | .id'     <<<"$json" | head -n1
}

vcn_json="$(oci network vcn list --compartment-id "$OCI_COMPARTMENT_OCID" --all)"
VCN_ID="$(id_by_name "$vcn_json" "$VCN_NAME")"
if [[ -z "$VCN_ID" ]]; then
  VCN_ID="$(oci network vcn create     --compartment-id "$OCI_COMPARTMENT_OCID"     --display-name "$VCN_NAME"     --cidr-block "$VCN_CIDR"     --dns-label botfactory     --wait-for-state AVAILABLE     --query 'data.id' --raw-output)"
fi

vcn_info="$(oci network vcn get --vcn-id "$VCN_ID")"
ROUTE_TABLE_ID="$(jq -r '.data."default-route-table-id"' <<<"$vcn_info")"
SECURITY_LIST_ID="$(jq -r '.data."default-security-list-id"' <<<"$vcn_info")"

igw_json="$(oci network internet-gateway list   --compartment-id "$OCI_COMPARTMENT_OCID"   --vcn-id "$VCN_ID"   --all)"
IGW_ID="$(id_by_name "$igw_json" "$IGW_NAME")"
if [[ -z "$IGW_ID" ]]; then
  IGW_ID="$(oci network internet-gateway create     --compartment-id "$OCI_COMPARTMENT_OCID"     --vcn-id "$VCN_ID"     --display-name "$IGW_NAME"     --is-enabled true     --wait-for-state AVAILABLE     --query 'data.id' --raw-output)"
fi

route_rules="$(jq -nc --arg igw "$IGW_ID" '[{"cidrBlock":"0.0.0.0/0","networkEntityId":$igw}]')"
oci network route-table update   --rt-id "$ROUTE_TABLE_ID"   --route-rules "$route_rules"   --force >/dev/null

ingress='[{"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}}]'
egress='[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]'
oci network security-list update   --security-list-id "$SECURITY_LIST_ID"   --ingress-security-rules "$ingress"   --egress-security-rules "$egress"   --force >/dev/null

subnet_json="$(oci network subnet list   --compartment-id "$OCI_COMPARTMENT_OCID"   --vcn-id "$VCN_ID"   --all)"
SUBNET_ID="$(id_by_name "$subnet_json" "$SUBNET_NAME")"
if [[ -z "$SUBNET_ID" ]]; then
  SUBNET_ID="$(oci network subnet create     --compartment-id "$OCI_COMPARTMENT_OCID"     --vcn-id "$VCN_ID"     --display-name "$SUBNET_NAME"     --cidr-block "$SUBNET_CIDR"     --dns-label bots     --route-table-id "$ROUTE_TABLE_ID"     --security-list-ids "[\"$SECURITY_LIST_ID\"]"     --prohibit-public-ip-on-vnic false     --wait-for-state AVAILABLE     --query 'data.id' --raw-output)"
fi

instances="$(oci compute instance list   --compartment-id "$OCI_COMPARTMENT_OCID"   --display-name "$INSTANCE_NAME"   --all)"
INSTANCE_ID="$(jq -r --arg n "$INSTANCE_NAME"   '.data[]? | select(."display-name"==$n and ."lifecycle-state" != "TERMINATED") | .id'   <<<"$instances" | head -n1)"

key_file="$(mktemp)"
trap 'rm -f "$key_file"' EXIT
printf '%s\n' "$BOT_FACTORY_SSH_PRIVATE_KEY" > "$key_file"
chmod 600 "$key_file"
ssh_public_key="$(ssh-keygen -y -f "$key_file")"

if [[ -z "$INSTANCE_ID" ]]; then
  cloud_init="$(mktemp)"
  cat > "$cloud_init" <<'CLOUD'
#!/usr/bin/env bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io ca-certificates curl jq ufw
systemctl enable --now docker
usermod -aG docker ubuntu || true
mkdir -p /opt/bot-factory/apps
chown -R ubuntu:ubuntu /opt/bot-factory
cat >/etc/ssh/sshd_config.d/99-bot-factory.conf <<'SSH'
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
SSH
systemctl restart ssh || systemctl restart sshd
ufw allow 22/tcp
ufw --force enable
CLOUD

  user_data="$(base64 -w 0 "$cloud_init")"
  rm -f "$cloud_init"
  metadata="$(jq -nc     --arg ssh "$ssh_public_key"     --arg user_data "$user_data"     '{ssh_authorized_keys:$ssh,user_data:$user_data}')"

  mapfile -t ads < <(
    oci iam availability-domain list       --compartment-id "$OCI_TENANCY_OCID" |
      jq -r '.data[].name'
  )

  if [[ "${#ads[@]}" -eq 0 ]]; then
    echo "::error::No OCI availability domains were returned."
    exit 1
  fi

  launched=0
  for shape in VM.Standard.A1.Flex VM.Standard.E2.1.Micro; do
    image_id="$(oci compute image list       --compartment-id "$OCI_COMPARTMENT_OCID"       --operating-system 'Canonical Ubuntu'       --shape "$shape"       --all |
      jq -r '.data | sort_by(."time-created") | reverse | .[0].id // empty')"
    [[ -n "$image_id" ]] || continue

    for ad in "${ads[@]}"; do
      echo "Trying free-tier OCI shape=$shape availability-domain=$ad"
      set +e
      if [[ "$shape" == "VM.Standard.A1.Flex" ]]; then
        launch_json="$(oci compute instance launch           --availability-domain "$ad"           --compartment-id "$OCI_COMPARTMENT_OCID"           --display-name "$INSTANCE_NAME"           --shape "$shape"           --shape-config '{"ocpus":1,"memoryInGBs":6}'           --subnet-id "$SUBNET_ID"           --image-id "$image_id"           --assign-public-ip true           --metadata "$metadata"           --wait-for-state RUNNING 2>&1)"
      else
        launch_json="$(oci compute instance launch           --availability-domain "$ad"           --compartment-id "$OCI_COMPARTMENT_OCID"           --display-name "$INSTANCE_NAME"           --shape "$shape"           --subnet-id "$SUBNET_ID"           --image-id "$image_id"           --assign-public-ip true           --metadata "$metadata"           --wait-for-state RUNNING 2>&1)"
      fi
      status=$?
      set -e

      if [[ "$status" -eq 0 ]]; then
        INSTANCE_ID="$(jq -r '.data.id' <<<"$launch_json")"
        launched=1
        break 2
      fi
      echo "$launch_json" >&2
    done
  done

  if [[ "$launched" -ne 1 || -z "$INSTANCE_ID" ]]; then
    echo "::error::No supported free-tier OCI compute capacity was available. Factory will not fall back to a paid shape."
    exit 1
  fi
else
  state="$(oci compute instance get     --instance-id "$INSTANCE_ID"     --query 'data."lifecycle-state"'     --raw-output)"
  if [[ "$state" == "STOPPED" ]]; then
    oci compute instance action       --instance-id "$INSTANCE_ID"       --action START       --wait-for-state RUNNING >/dev/null
  fi
fi

PUBLIC_IP=""
for attempt in $(seq 1 30); do
  PUBLIC_IP="$(oci compute instance list-vnics     --instance-id "$INSTANCE_ID" |
    jq -r '.data[0]."public-ip" // empty')"
  [[ -n "$PUBLIC_IP" ]] && break
  sleep 5
done

if [[ -z "$PUBLIC_IP" ]]; then
  echo "::error::OCI host has no public IP."
  exit 1
fi

echo "instance_id=$INSTANCE_ID" >> "$GITHUB_OUTPUT"
echo "public_ip=$PUBLIC_IP" >> "$GITHUB_OUTPUT"
