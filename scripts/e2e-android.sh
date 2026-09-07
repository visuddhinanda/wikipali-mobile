#!/usr/bin/env bash
#
# 真机冒烟回归：把 docs/testing.md 里能自动化的部分跑一遍。
#
#   scripts/e2e-android.sh [输出目录]
#
# 前提（见 STATUS.md §12.3）：
#   - 宿主机跑着 `adb -a -P 5037 nodaemon server`，本机 ADB_SERVER_SOCKET 指过去
#   - 小米需打开「USB 调试（安全设置）」，否则注入事件被拒
#   - 已 install release 包
#
# 注意：阅读页正文区（WebView）里的控件收不到注入事件，脚本不测它们，
# 只在最后列出需要人工点的项。
set -uo pipefail

PKG=com.iapt.mobile
ACT=$PKG/.MainActivity
OUT=${1:-/tmp/e2e-$(date +%H%M%S)}
export ADB_SERVER_SOCKET=${ADB_SERVER_SOCKET:-tcp:127.0.0.1:5037}
mkdir -p "$OUT"

pass=0; fail=0; failed_names=()

log()  { printf '%s\n' "$*"; }
ok()   { pass=$((pass+1)); log "  ✓ $1"; }
bad()  { fail=$((fail+1)); failed_names+=("$1"); log "  ✗ $1 —— $2"; }

dump() { adb shell uiautomator dump /sdcard/e2e.xml >/dev/null 2>&1
         adb shell cat /sdcard/e2e.xml 2>/dev/null | tr '<' '\n<'; }
texts() { dump | grep -oE 'text="[^"]{1,60}"' | sed -E 's/^text="//; s/"$//'; }
# 只保留像条目标题的行（去掉空行、Tab 名、分段标题）
titles_only() { texts | grep -vxE '书架|在读|已下载|收藏|分类|探索|工具|我|' \
                       | grep -E '[A-Za-z]'; }
# 某个 text 的中心坐标（第一个匹配）。text 里可能带括号（如「(DN) …」），
# 所以先按字面量筛出那一行，再用正则取 bounds——直接把 text 拼进正则会当成分组。
center() {
  dump | grep -F "text=\"$1\"" \
    | grep -oE "text=\"[^\"]*\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" \
    | head -1 \
    | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' \
    | sed -E 's/\]\[/ /; s/[][]//g' \
    | awk -F'[ ,]' '{print int(($1+$3)/2), int(($2+$4)/2)}'
}
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }

# 关掉可能挡在前面的系统弹窗（按钮文案随语言变）
alert_ok() {
  local xy
  for label in 知道了 OK 确定; do
    xy=$(center "$label")
    if [ -n "$xy" ]; then adb shell input tap ${xy% *} ${xy#* }; sleep 2; return 0; fi
  done
  return 1
}

# 点击并等界面变化；注入点击约三成会被吞，所以最多点 5 次
tap_until() { # tap_until X Y 期望出现的文本
  local x=$1 y=$2 want=$3
  for _ in 1 2 3 4 5; do
    adb shell input tap "$x" "$y"; sleep 4
    if texts | grep -qF "$want"; then return 0; fi
  done
  return 1
}
tap_text() { # tap_text 目标文本 期望出现的文本
  local xy; xy=$(center "$1")
  [ -z "$xy" ] && return 1
  tap_until ${xy% *} ${xy#* } "$2"
}
# 分组标题下面那行（当前值）才是可点的行：取标题 bounds 下方 ~110px
tap_row_under() { # tap_row_under 分组标题 期望出现的文本
  local xy y
  xy=$(dump | grep -F "text=\"$1\"" \
       | grep -oE "text=\"[^\"]*\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" | head -1 \
       | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | sed -E 's/\]\[/ /; s/[][]//g' \
       | awk -F'[ ,]' '{print int(($2+$4)/2)}')
  [ -z "$xy" ] && return 1
  y=$((xy + 110))
  tap_until 540 "$y" "$2"
}
restart() {
  adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  adb shell am force-stop $PKG
  adb shell am start -n $ACT >/dev/null
  sleep 12
}
# 回到分类首页的已知状态。连续 back 会退出 App（后面就在操作桌面了），
# 所以每一节都从冷启动重来，慢一点但确定。
reset_to_home() { restart; }
back() { adb shell input keyevent KEYCODE_BACK; sleep 3; }
# 底部 Tab：点在文字上（y=2368）；y=2300 落在图标上方的空档，经常不响应。
# 「探索」是中间凸起的圆形按钮，文字在按钮外面，得点圆心（y=2250）。
tab() { local y=2368
        case $1 in discover) x=108;; shelf) x=324;; explore) x=540; y=2250;; tools) x=756;; me) x=972;; esac
        tap_until $x $y "$2"; }

log "== 输出目录 $OUT"
adb devices -l | sed -n 2p

########################################
log ""; log "1. 冷启动"
restart
if texts | grep -q "巴利三藏"; then ok "1.1 冷启动进入分类页"; else bad "1.1 冷启动" "首屏不是分类页"; fi
if adb logcat -d | grep -q "FATAL EXCEPTION"; then bad "1.2 启动无崩溃" "logcat 有 FATAL"; else ok "1.2 启动无崩溃"; fi

########################################
log ""; log "2. 五个 Tab"
for t in "shelf 书架" "explore -" "tools 工具" "me 尚未登录" "discover 巴利三藏"; do
  set -- $t
  if [ "$1" = explore ]; then
    tab explore "AI 功能暂未开放" && ok "2.x 探索 Tab 弹「AI 功能暂未开放」" \
      || bad "2.x 探索 Tab" "没有弹出提示"
    alert_ok || true
  else
    tab "$1" "$2" && ok "2.x $1 Tab 可进入" || bad "2.x $1 Tab" "没切过去"
  fi
done

########################################
log ""; log "3. 分类 → 目录树 → 版本列表（入口 A：分类/根本）"
tab discover "巴利三藏" >/dev/null
alert_ok >/dev/null 2>&1 || true
tap_text "经藏" "长部"            && ok "3.1 经藏"      || bad "3.1 经藏" "没进去"
tap_text "长部" "戒蕴品"          && ok "3.2 长部"      || bad "3.2 长部" "没进去"
tap_text "戒蕴品" "根本"          && ok "3.3 戒蕴品"    || bad "3.3 戒蕴品" "没进去"
tap_text "dīghanikāyapāḷi" "个版本" && ok "3.4 根本版本列表" || bad "3.4 根本版本列表" "没进去"
shot 3-channels-mula

########################################
log ""; log "4. 阅读器（入口 A 续）：三层标签 + 翻章"
if tap_text "Claude" "原文"; then
  sleep 6
  ok "4.1 从根本版本进入"
  t=$(texts | head -5 | tr '\n' ' ')
  echo "$t" | grep -q "原文" && echo "$t" | grep -q "义注" \
    && ok "4.2 根本入口显示三层标签" || bad "4.2 根本入口三层标签" "实际：$t"
  shot 4-reader-mula
  for i in 1 2 3; do adb shell input tap 516 371; sleep 5; done
  shot 4-after-next
  adb logcat -d | grep -qi "cannot rollback" \
    && bad "4.3 连翻三章无事务报错" "logcat 出现 cannot rollback" \
    || ok "4.3 连翻三章无事务报错"
else
  bad "4.1 从根本版本进入" "没进阅读器"
fi

########################################
log ""; log "5. 入口 B：分类 → 义注版本"
reset_to_home
tap_text "经藏" "长部" >/dev/null
tap_text "长部" "戒蕴品" >/dev/null
tap_text "戒蕴品" "义注" >/dev/null
tap_text "sumaṅgalavilāsinī" "个版本" && ok "5.1 义注版本列表" || bad "5.1 义注版本列表" "没进去"
if tap_text "deepseek" "义注"; then
  sleep 8
  ok "5.2 从义注版本进入"
  t=$(texts | head -5 | tr '\n' ' ')
  # 停在义注层：章节标题是 …vaṇṇanā，标签栏含「义注」。
  # 注意「原文」标签本身不是 bug——该章在根本里有对应章节时它就该出现（a9db851）。
  echo "$t" | grep -q "vaṇṇanā" && echo "$t" | grep -q "义注" \
    && ok "5.3 义注入口停在义注层" \
    || bad "5.3 义注入口停在义注层" "实际：$t"
  shot 5-reader-atthakatha
else
  bad "5.2 从义注版本进入" "没进阅读器"
fi

########################################
log ""; log "6. 阅读进度恢复（入口 A/B 通用）"
for i in 1 2 3; do adb shell input tap 516 371; sleep 5; done
# 长按浮层（「就此段落提问」）会盖住头部，读不到段落号，先点空白关掉
texts | grep -q "就此段落提问" && { adb shell input tap 540 900; sleep 2; }
before=$(texts | grep -oE '段落 [0-9]+' | head -1)
back                     # 从阅读器回到版本列表（只退一层，仍在 App 内）
if tap_text "deepseek" "义注"; then
  sleep 8
  after=$(texts | grep -oE '段落 [0-9]+' | head -1)
  [ -n "$before" ] && [ "$before" = "$after" ] \
    && ok "6.1 退出重进恢复到 $after" \
    || bad "6.1 退出重进恢复位置" "退出前 ${before:-?}，重进 ${after:-?}"
else
  bad "6.1 退出重进恢复位置" "没能重新进入"
fi

########################################
log ""; log "7. 入口 C：书架 → 在读"
reset_to_home
tab shelf "在读" >/dev/null
shot 7-shelf-reading
titles=$(texts | sed -n 5,12p | tr '\n' '|')
echo "$titles" | grep -qE "义注|复注|根本" \
  && ok "7.1 在读副标题带层次 tag" || bad "7.1 在读层次 tag" "实际：$titles"
echo "$titles" | grep -qE "\(DN\)" \
  && ok "7.2 在读标题是作品名" || bad "7.2 在读标题" "实际：$titles"
first=$(titles_only | head -1)
if [ -n "$first" ] && tap_text "$first" "版本"; then
  sleep 8; ok "7.3 从在读条目进入阅读器"; shot 7-reader-from-shelf
  texts | head -5 | grep -q "义注" && ok "7.4 进入后停在记录的层" || log "  · 7.4 该条目不是义注层，跳过"
else
  bad "7.3 从在读条目进入" "没进去"
fi

########################################
log ""; log "8. 入口 D：书架 → 已下载"
reset_to_home
tab shelf "已下载" >/dev/null
tap_text "已下载" "段" && ok "8.1 已下载列表" || bad "8.1 已下载列表" "没有下载条目或没切过去"
shot 8-shelf-downloads
dtitle=$(titles_only | head -1)
if [ -n "$dtitle" ] && tap_text "$dtitle" "版本"; then
  sleep 8; ok "8.2 从已下载条目进入阅读器"
  ch=$(texts | grep -oE '_System_Pali_VRI_' | head -1)
  [ -n "$ch" ] && bad "8.3 已下载的书不该退化到 _System_Pali_VRI_" "版本是 $ch" \
               || ok "8.3 已下载的书用的是本地已有版本"
  shot 8-reader-from-download
else
  bad "8.2 从已下载条目进入" "没进去"
fi

########################################
log ""; log "9. 设置 / 我"
reset_to_home
tab me "尚未登录" >/dev/null
tap_text "设置" "API 服务器" && ok "9.1 设置页" || bad "9.1 设置页" "没进去"
# 「语言偏好」「API 服务器」是分组标题，不可点；可点的是它下面显示当前值的那行
tap_row_under "语言偏好" "跟随系统" && ok "9.2 语言页" || bad "9.2 语言页" "没进去"
back
tap_row_under "API 服务器" "api/v2" && ok "9.3 API 服务器页" || bad "9.3 API 服务器页" "没进去"
back
tap_text "关于 / 反馈" "版本" && ok "9.4 关于页" || bad "9.4 关于页" "没进去"
texts | grep -q "Wikipali" && ok "9.5 关于页应用名与桌面一致" || bad "9.5 关于页应用名" "不是 Wikipali"

########################################
log ""; log "10. 稳定性"
adb logcat -d | grep -q "FATAL EXCEPTION" && bad "10.1 全程无崩溃" "logcat 有 FATAL" || ok "10.1 全程无崩溃"
adb logcat -d | grep -qiE "no such table|cannot rollback" \
  && bad "10.2 全程无 SQLite 报错" "logcat 有 SQLite 报错" || ok "10.2 全程无 SQLite 报错"

########################################
log ""
log "================ 结果 ================"
log "通过 $pass ／ 失败 $fail"
for n in "${failed_names[@]:-}"; do [ -n "$n" ] && log "  ✗ $n"; done
log ""
log "需人工点击（注入事件到不了 WebView 区域）："
log "  · 阅读页「就此段落提问」→ 应弹「AI 功能暂未开放」"
log "  · 横滑切层、字号条拖动"
log "截图在 $OUT"
[ "$fail" -eq 0 ]
