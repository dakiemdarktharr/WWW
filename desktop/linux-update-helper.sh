set -eu
umask 077

target=$1
staging=$2
pid=$3
failure=$4
profile=$5
candidate=$staging/Kivuno
backup=$staging/previous

restart() {
  if [ -n "$profile" ]; then
    "$target/kivuno" "--user-data-dir=$profile" &
  else
    "$target/kivuno" &
  fi
  restarted=$!
}

# The prepared directory and backup are on the installation filesystem.
attempts=0
while kill -0 "$pid" 2>/dev/null; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 120 ]; then
    printf 'failed\n' > "$failure"
    rm -rf -- "$candidate"
    rmdir -- "$staging"
    exit 1
  fi
  sleep 1
done

if mv -T -- "$target" "$backup"; then
  if mv -T -- "$candidate" "$target"; then
    restart
    sleep 1
    if kill -0 "$restarted" 2>/dev/null; then
      rm -rf -- "$backup"
      rmdir -- "$staging"
      exit 0
    fi
    if ! mv -T -- "$target" "$candidate"; then
      printf 'failed\n' > "$failure"
      exit 1
    fi
  fi
  # Preserve the previous install for manual recovery if moving it back fails.
  mv -T -- "$backup" "$target" || true
fi

printf 'failed\n' > "$failure"
rm -rf -- "$candidate"
rmdir -- "$staging" 2>/dev/null || true
if [ -x "$target/kivuno" ]; then restart; fi
