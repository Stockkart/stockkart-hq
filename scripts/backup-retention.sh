#!/usr/bin/env bash
# Retention rules of the nightly backup (SPEC §9.3, .github/workflows/backup.yml): 7 daily
# and 4 weekly copies. Pure date logic, no network, so it is unit-tested
# (src/test/backup-retention.test.ts) and the workflow only lists and deletes what it prints.
#
#   backup-retention.sh is-weekly <YYYY-MM-DD>
#       exit 0 when the date is a Sunday (the night that also writes backups/weekly/).
#   backup-retention.sh expired <YYYY-MM-DD today> < keys
#       reads object keys (one per line) and prints the ones to delete:
#         backups/daily/<date>.sql.gz   when <date> is 7 or more days before today
#         backups/weekly/<date>.sql.gz  when <date> is 28 or more days before today
#       Every other key (tmp/, attachments, anything misnamed) is never printed.
set -euo pipefail

readonly DAILY_KEEP_DAYS=7
readonly WEEKLY_KEEP_DAYS=28
readonly KEY_PATTERN='^backups/(daily|weekly)/([0-9]{4}-[0-9]{2}-[0-9]{2})\.sql\.gz$'

die() {
  echo "backup-retention: $*" >&2
  exit 2
}

# A real calendar date in YYYY-MM-DD form (GNU date; ubuntu runners and Debian images).
valid_date() {
  [[ $1 =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ $(date -u -d "$1" +%F 2>/dev/null) == "$1" ]]
}

days_before() {
  date -u -d "$1 - $2 days" +%F
}

cmd_is_weekly() {
  valid_date "${1:-}" || die "is-weekly needs a YYYY-MM-DD date"
  [[ $(date -u -d "$1" +%u) == 7 ]]
}

cmd_expired() {
  local today=${1:-}
  valid_date "$today" || die "expired needs today's date as YYYY-MM-DD"
  local daily_cutoff weekly_cutoff key kind day
  daily_cutoff=$(days_before "$today" "$DAILY_KEEP_DAYS")
  weekly_cutoff=$(days_before "$today" "$WEEKLY_KEEP_DAYS")
  while IFS= read -r key || [[ -n $key ]]; do
    [[ $key =~ $KEY_PATTERN ]] || continue
    kind=${BASH_REMATCH[1]}
    day=${BASH_REMATCH[2]}
    valid_date "$day" || continue
    # ISO dates compare correctly as strings.
    if [[ $kind == daily && ! $day > $daily_cutoff ]]; then
      echo "$key"
    elif [[ $kind == weekly && ! $day > $weekly_cutoff ]]; then
      echo "$key"
    fi
  done
}

case "${1:-}" in
  is-weekly) cmd_is_weekly "${2:-}" ;;
  expired) cmd_expired "${2:-}" ;;
  *) die "usage: backup-retention.sh is-weekly <date> | expired <today> < keys" ;;
esac
