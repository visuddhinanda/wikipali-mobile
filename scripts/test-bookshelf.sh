#!/usr/bin/env bash
# 书架功能测试（多用户同步）—— 真机 + 本地服务器
#
# 用法：scripts/test-bookshelf.sh
# 依赖：宿主机 adb server（tcp:127.0.0.1:5037）、本地服务器 127.0.0.1:8000、
#       sqlite3、curl、python3。
# 检查表见 docs/multi-user-sync.md §12。
set -u
export ADB_SERVER_SOCKET=tcp:127.0.0.1:5037

SQLITE="${SQLITE:-/home/deploy/Android/Sdk/platform-tools/sqlite3}"
SERVER="${SERVER:-http://127.0.0.1:8000}"
USER_ACCOUNT="${USER_ACCOUNT:-visuddhinanda}"
USER_PASSWORD="${USER_PASSWORD:-123456}"
APP_DB_ROOT="/data/data/com.iapt.mobile/files/SQLite"

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; CYAN='\033[36m'; NC='\033[0m'
PASS=0; FAIL=0; SKIP=0

pass() { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
skip() { echo -e "${YELLOW}SKIP${NC} $1"; SKIP=$((SKIP+1)); }
info() { echo -e "${CYAN}==${NC} $1"; }

# ── 环境 ──
info "环境检查"
DEVICE=$(adb devices | awk 'NR==2{print $1}')
if [ -n "$DEVICE" ]; then pass "adb 设备在线：$DEVICE"; else fail "adb 无设备"; fi

TOKEN=$(curl -s -m 5 -X POST "$SERVER/api/v2/sign-in" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER_ACCOUNT\",\"password\":\"$USER_PASSWORD\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('data',''))" 2>/dev/null)
if [ -n "$TOKEN" ]; then pass "服务器登录成功，token 长度 ${#TOKEN}"; else fail "服务器登录失败（$SERVER）"; fi

if [ -x "$SQLITE" ] || command -v sqlite3 >/dev/null 2>&1; then
  [ -x "$SQLITE" ] || SQLITE=sqlite3
  pass "sqlite3 可用"
else
  fail "sqlite3 不可用"
fi

# ── 辅助：读某个用户库的一张表 ──
# 用法：db_query <uuid> <sql>
db_query() {
  local uuid="$1" sql="$2" tmp
  tmp=$(mktemp -d)
  adb exec-out run-as com.iapt.mobile cat "$APP_DB_ROOT/users/$uuid/reading.db3" > "$tmp/db" 2>/dev/null
  adb exec-out run-as com.iapt.mobile cat "$APP_DB_ROOT/users/$uuid/reading.db3-wal" > "$tmp/db-wal" 2>/dev/null
  adb exec-out run-as com.iapt.mobile cat "$APP_DB_ROOT/users/$uuid/reading.db3-shm" > "$tmp/db-shm" 2>/dev/null
  "$SQLITE" "$tmp/db" "$sql" 2>/dev/null
  rm -rf "$tmp"
}

# 服务器查询
server_reactions() { # <type>
  curl -s -m 8 "$SERVER/api/v3/me/reactions?type=$1&target_type=progress_chapter&per_page=100" \
    -H "Authorization: Bearer $TOKEN"
}
# ── 目录结构 ──
info "本地目录结构"
DIRS=$(adb shell run-as com.iapt.mobile ls "$APP_DB_ROOT/users/" 2>/dev/null | tr -d '\r')
GUEST_UUID=$(echo "$DIRS" | grep -vE '^$' | head -1)
echo "$DIRS" | grep -qE '^[0-9a-f-]{36}$' && pass "users/ 下有 uuid 子目录：$(echo "$DIRS" | tr '\n' ' ')" || fail "users/ 目录异常"

# 用户 uuid = /auth/current 的 id（= user_uid）
USER_UUID=$(curl -s -m 8 "$SERVER/api/v2/auth/current" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)

# ── guest 库 ──
info "guest 库（$GUEST_UUID）"
if [ -n "$GUEST_UUID" ]; then
  G_OUTBOX=$(db_query "$GUEST_UUID" "SELECT count(*) FROM sync_outbox;")
  [ "$G_OUTBOX" = "0" ] && pass "guest sync_outbox = 0（游客不同步）" || fail "guest sync_outbox = $G_OUTBOX（应为 0）"
  echo "  reading_history=$(db_query "$GUEST_UUID" "SELECT count(*) FROM reading_history;")  bookmarks=$(db_query "$GUEST_UUID" "SELECT count(*) FROM bookmarks;")  starred=$(db_query "$GUEST_UUID" "SELECT count(*) FROM starred;")  download_state=$(db_query "$GUEST_UUID" "SELECT count(*) FROM download_state;")"
else
  skip "未取得 guest uuid"
fi

# ── user 库 ──
info "user 库（$USER_UUID）"
if [ -n "$USER_UUID" ]; then
  echo "  reading_history=$(db_query "$USER_UUID" "SELECT count(*) FROM reading_history;")  bookmarks=$(db_query "$USER_UUID" "SELECT count(*) FROM bookmarks;")  starred=$(db_query "$USER_UUID" "SELECT count(*) FROM starred;")  download_state=$(db_query "$USER_UUID" "SELECT count(*) FROM download_state;")"
  U_OUTBOX=$(db_query "$USER_UUID" "SELECT count(*) FROM sync_outbox;")
  U_ATT=$(db_query "$USER_UUID" "SELECT coalesce(sum(attempts),0) FROM sync_outbox;")
  if [ "$U_OUTBOX" = "0" ]; then pass "user sync_outbox 已清空（无待同步）"
  else info "user sync_outbox 待同步 $U_OUTBOX 条（累计 attempts $U_ATT）——离线时有值属正常"; fi
else
  skip "未取得 user uuid（可能未登录过）"
fi

# ── 服务器 ──
info "服务器数据"
for t in favorite bookmark download; do
  N=$(server_reactions "$t" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null)
  echo "  $t = $N"
done
RN=$(curl -s -m 8 "$SERVER/api/v2/recent?view=user&id=$USER_UUID&type=chapter&limit=1000" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('data',{}).get('rows',[])))" 2>/dev/null)
echo "  recent(chapter) = $RN"

# ── 报告 ──
info "报告"
echo "------------------------------------------------"
echo -e "通过 ${GREEN}$PASS${NC} / 失败 ${RED}$FAIL${NC} / 跳过 ${YELLOW}$SKIP${NC}"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
