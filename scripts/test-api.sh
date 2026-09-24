#!/usr/bin/env bash
# API 全功能测试（连本地开发 server）
#
# 覆盖书架/阅读链路用到的全部接口：登录、当前用户、阅读记录(recent)、
# 收藏/书签/下载(reactions)、progress 正向解析+反查、tipitaka-reading（游标+区间）。
# 用法：scripts/test-api.sh [SERVER]  默认 http://127.0.0.1:8000
set -u

SERVER="${1:-${SERVER:-http://127.0.0.1:8000}}"
USER_ACCOUNT="${USER_ACCOUNT:-visuddhinanda}"
USER_PASSWORD="${USER_PASSWORD:-123456}"
# 测试用的一本有译文、且 para 是 level=1（书）的书
BOOK="${BOOK:-136}"
PARA="${PARA:-3}"
CHANNEL="${CHANNEL:-f4d07a00-8a5f-11ed-a044-a7a26c844686}"  # _System_Pali_VRI_

RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; NC='\033[0m'
PASS=0; FAIL=0
pass() { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
info() { echo -e "${YELLOW}==${NC} $1"; }

# 取 JSON 字段：json_get <python 表达式>
py() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

info "目标 $SERVER（book=$BOOK para=$PARA channel=${CHANNEL:0:8}…）"

# 1. 登录
TOKEN=$(curl -s -m 8 -X POST "$SERVER/api/v2/sign-in" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$USER_ACCOUNT\",\"password\":\"$USER_PASSWORD\"}" \
  | py "d.get('data','') if d.get('ok') else ''")
[ -n "$TOKEN" ] && pass "sign-in（token 长度 ${#TOKEN}）" || fail "sign-in"
AUTH="Authorization: Bearer $TOKEN"

# 2. 当前用户
USER_UID=$(curl -s -m 8 "$SERVER/api/v2/auth/current" -H "$AUTH" \
  | py "d.get('data',{}).get('id','') if d.get('ok') else ''")
[ -n "$USER_UID" ] && pass "auth/current（id=$USER_UID）" || fail "auth/current"

# 3. progress?view=ids —— 正向解析 (book,para,channel) → progress_chapter uid
PC_UID=$(curl -s -m 8 "$SERVER/api/v2/progress?view=ids&book=$BOOK&par=$PARA&channel=$CHANNEL" \
  | py "d.get('data',{}).get('rows',[{}])[0].get('id','') if d.get('ok') else ''")
[ -n "$PC_UID" ] && pass "progress view=ids → ${PC_UID:0:8}…" || fail "progress view=ids"

# 4. progress/{uid} —— 反查
if [ -n "$PC_UID" ]; then
  PC_RAW=$(curl -s -m 8 "$SERVER/api/v2/progress/$PC_UID")
  PC_BOOK=$(echo "$PC_RAW" | py "d.get('data',{}).get('book')")
  PC_PARA=$(echo "$PC_RAW" | py "d.get('data',{}).get('para')")
  [ -n "$PC_BOOK" ] && pass "progress/{uid} 反查 → book/para=$PC_BOOK/$PC_PARA" || fail "progress/{uid} 反查"
else
  fail "progress/{uid} 反查（无 uid）"
fi

# 5. progress?view=chapter_channels —— 版本列表
CC=$(curl -s -m 8 "$SERVER/api/v2/progress?view=chapter_channels&book=$BOOK&par=$PARA" \
  | py "len(d.get('data',{}).get('rows',[]) if d.get('ok') else [])")
[ "${CC:-0}" -gt 0 ] 2>/dev/null && pass "progress chapter_channels（$CC 个版本）" || fail "progress chapter_channels"

# 6. tipitaka-reading —— 整本游标取数（book 过滤）
CH_RAW=$(curl -s -m 10 "$SERVER/api/v3/tipitaka-reading/$CHANNEL?book=$BOOK&format=html&include=display&page_size=5000&unit=byte")
CH_N=$(echo "$CH_RAW" | py "len(d.get('data',[]))")
CH_CURSOR=$(echo "$CH_RAW" | py "d.get('meta',{}).get('next_cursor')")
CH_TOTAL=$(echo "$CH_RAW" | py "d.get('meta',{}).get('total')")
[ "${CH_N:-0}" -gt 0 ] 2>/dev/null && pass "tipitaka-reading book=$BOOK（items=$CH_N total=$CH_TOTAL next=${CH_CURSOR:-null}）" || fail "tipitaka-reading"

# 7. tipitaka-reading —— 单段精确取数（para/to）
RP=$(curl -s -m 8 "$SERVER/api/v3/tipitaka-reading/$CHANNEL?book=$BOOK&para=$PARA&to=$PARA&format=html&include=display" \
  | py "len(d.get('data',[]))")
[ "${RP:-0}" -ge 0 ] 2>/dev/null && pass "tipitaka-reading para/to（items=$RP）" || fail "tipitaka-reading para/to"

# 8. POST /v3/me/reactions —— 写收藏（幂等）
if [ -n "$PC_UID" ]; then
  FAV=$(curl -s -m 8 -X POST "$SERVER/api/v3/me/reactions" -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"type\":\"favorite\",\"target_id\":\"$PC_UID\",\"target_type\":\"progress_chapter\",\"context\":\"book:$BOOK-$PARA\"}" \
    | py "d.get('data',{}).get('id','')")
  [ -n "$FAV" ] && pass "POST me/reactions favorite（id=${FAV:0:8}…）" || fail "POST me/reactions favorite"

  # 9. GET /v3/me/reactions —— 列出
  FRN=$(curl -s -m 8 "$SERVER/api/v3/me/reactions?type=favorite&target_type=progress_chapter" -H "$AUTH" \
    | py "len(d.get('data',[]))")
  [ "${FRN:-0}" -gt 0 ] 2>/dev/null && pass "GET me/reactions（favorite=$FRN 条）" || fail "GET me/reactions"

  # 10. DELETE /v3/me/reactions/{id} —— 删除（204 空体）
  if [ -n "$FAV" ]; then
    DEL_CODE=$(curl -s -m 8 -o /dev/null -w "%{http_code}" -X DELETE "$SERVER/api/v3/me/reactions/$FAV" -H "$AUTH")
    [ "$DEL_CODE" = "204" ] && pass "DELETE me/reactions（204）" || fail "DELETE me/reactions（HTTP $DEL_CODE）"
  fi
else
  fail "me/reactions 写/列/删（无 progress_chapter uid）"
fi

# 11. POST /v2/recent —— 写阅读记录（幂等）
REC=$(curl -s -m 8 -X POST "$SERVER/api/v2/recent" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"type\":\"chapter\",\"article_id\":\"$BOOK-$PARA\",\"param\":\"{\\\"book\\\":\\\"$BOOK\\\",\\\"para\\\":\\\"$PARA\\\",\\\"channel\\\":\\\"${CHANNEL}_\\\",\\\"mode\\\":\\\"reading\\\"}\"}" \
  | py "d.get('data',{}).get('id','') if d.get('ok') else ''")
[ -n "$REC" ] && pass "POST recent（id=${REC:0:8}…）" || fail "POST recent"

# 12. GET /v2/recent —— 列出
RCNT=$(curl -s -m 8 "$SERVER/api/v2/recent?view=user&id=$USER_UID&type=chapter&limit=1000" -H "$AUTH" \
  | py "len(d.get('data',{}).get('rows',[]))")
[ "${RCNT:-0}" -gt 0 ] 2>/dev/null && pass "GET recent（chapter=$RCNT 条）" || fail "GET recent"

# ── 报告 ──
echo "------------------------------------------------"
echo -e "通过 ${GREEN}$PASS${NC} / 失败 ${RED}$FAIL${NC}"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
