/**
 * 飞行计算：输入航班号取起降时刻，沿大圆航线逐分钟判断太阳高度，给出途中
 * 真正会遇到的明相、日中与日暮。
 *
 * 「查不到航班」不能让整个功能作废 —— 手填起降机场与时刻的入口一直在，
 * 计算部分完全离线。没有事件也要给明确结论（「本航程未遇明相或日暮」），
 * 那是有效答案，不是空状态。
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Screen } from "../components/Screen";
import { colors, radius, spacing, type } from "../theme";
import { useT } from "../i18n/I18nContext";
import type { MessageKey } from "../i18n";
import {
  NoFlightProviderError,
  lookupFlight,
  manualSchedule,
  type FlightSchedule,
} from "../calendar/flight/provider";
import { flightSunEvents, legDistanceKm, type FlightEvent } from "../calendar/flight/events";
import { formatLocalTime, formatOffset } from "../calendar/tz";
import { nearestCity } from "../calendar/location/cities";

const EVENT_KEYS: Record<FlightEvent["kind"], MessageKey> = {
  departure: "calendar.flight.depart",
  aruna: "calendar.times.aruna",
  noon: "calendar.times.noon",
  dusk: "calendar.times.dusk",
  arrival: "calendar.flight.arrive",
};

/** 事件发生点的时区：机上时区跟着位置走，这正是算错最多的地方。 */
function zoneAt(lat: number, lon: number): string {
  return nearestCity(lat, lon)?.timeZone ?? "UTC";
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FlightSunScreen() {
  const t = useT();
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayIso());
  const [manual, setManual] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [departAt, setDepartAt] = useState("08:00");
  const [arriveAt, setArriveAt] = useState("11:45");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [schedule, setSchedule] = useState<FlightSchedule | null>(null);

  const events = schedule
    ? flightSunEvents({
        from: schedule.from,
        to: schedule.to,
        departure: schedule.departure,
        arrival: schedule.arrival,
      })
    : [];
  const crossings = events.filter((e) => e.kind === "aruna" || e.kind === "dusk");

  const runLookup = async () => {
    setBusy(true);
    setError(null);
    try {
      setSchedule(await lookupFlight(number, date));
    } catch (e) {
      setSchedule(null);
      setError(
        e instanceof NoFlightProviderError
          ? "calendar.flight.noProvider"
          : "calendar.flight.unknownAirport",
      );
      setManual(true);
    } finally {
      setBusy(false);
    }
  };

  const runManual = () => {
    setError(null);
    const depClock = parseClock(date, departAt);
    const arrClock = parseClock(date, arriveAt);
    if (!depClock || !arrClock) {
      setError("calendar.flight.badTime");
      setSchedule(null);
      return;
    }
    // 手填的时刻按各自机场的当地时间理解，转成 UTC 再算。
    const built = manualSchedule(from, to, depClock, arrClock);
    if (!built) {
      setError("calendar.flight.unknownAirport");
      setSchedule(null);
      return;
    }
    const depZone = built.from.timeZone;
    const arrZone = built.to.timeZone;
    const shift = (at: Date, zone: string) =>
      new Date(at.getTime() - offsetMinutes(at, zone) * 60000);
    const departure = shift(built.departure, depZone);
    let arrival = shift(built.arrival, arrZone);
    // 落地时刻早于起飞：跨了午夜，按次日算（东飞长途几乎都是这种）。
    if (arrival <= departure) arrival = new Date(arrival.getTime() + 86400_000);
    setSchedule({ ...built, departure, arrival });
  };

  return (
    <Screen contentStyle={styles.content}>
      {!manual ? (
        <View style={styles.row}>
          <TextInput
            style={[styles.field, styles.grow]}
            value={number}
            onChangeText={setNumber}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={t("calendar.flight.number")}
            placeholderTextColor={colors.inkFaint}
          />
          <TextInput
            style={[styles.field, styles.date]}
            value={date}
            onChangeText={setDate}
            autoCorrect={false}
          />
          <Pressable style={styles.button} onPress={runLookup} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={colors.paperRaised} />
            ) : (
              <Text style={styles.buttonText}>{t("calendar.flight.query")}</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.manual}>
          <View style={styles.row}>
            <TextInput
              style={[styles.field, styles.grow]}
              value={from}
              onChangeText={setFrom}
              autoCapitalize="characters"
              placeholder={`${t("calendar.flight.depart")} ${t("calendar.flight.airport")}`}
              placeholderTextColor={colors.inkFaint}
            />
            <TextInput
              style={[styles.field, styles.time]}
              value={departAt}
              onChangeText={setDepartAt}
            />
          </View>
          <View style={styles.row}>
            <TextInput
              style={[styles.field, styles.grow]}
              value={to}
              onChangeText={setTo}
              autoCapitalize="characters"
              placeholder={`${t("calendar.flight.arrive")} ${t("calendar.flight.airport")}`}
              placeholderTextColor={colors.inkFaint}
            />
            <TextInput
              style={[styles.field, styles.time]}
              value={arriveAt}
              onChangeText={setArriveAt}
            />
          </View>
          <View style={styles.row}>
            <TextInput style={[styles.field, styles.grow]} value={date} onChangeText={setDate} />
            <Pressable style={styles.button} onPress={runManual}>
              <Text style={styles.buttonText}>{t("calendar.flight.query")}</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Pressable onPress={() => setManual((m) => !m)}>
        <Text style={styles.link}>
          {manual ? t("calendar.flight.number") : t("calendar.flight.manual")}
        </Text>
      </Pressable>

      {error ? <Text style={styles.error}>{t(error)}</Text> : null}

      {schedule ? (
        <View style={styles.card}>
          <View style={styles.route}>
            <View>
              <Text style={styles.airport}>{schedule.from.iata}</Text>
              <Text style={styles.airportSub}>
                {formatLocalTime(schedule.departure, schedule.from.timeZone)}{" "}
                {formatOffset(schedule.departure, schedule.from.timeZone)}
              </Text>
            </View>
            <View style={styles.routeLine} />
            <View>
              <Text style={[styles.airport, styles.right]}>{schedule.to.iata}</Text>
              <Text style={[styles.airportSub, styles.right]}>
                {formatLocalTime(schedule.arrival, schedule.to.timeZone)}{" "}
                {formatOffset(schedule.arrival, schedule.to.timeZone)}
              </Text>
            </View>
          </View>
          <Text style={styles.meta}>
            {schedule.airline ? `${schedule.airline} · ` : ""}
            {Math.round(
              (schedule.arrival.getTime() - schedule.departure.getTime()) / 60000,
            )}{" "}
            min ·{" "}
            {Math.round(
              legDistanceKm({
                from: schedule.from,
                to: schedule.to,
                departure: schedule.departure,
                arrival: schedule.arrival,
              }),
            )}{" "}
            km
          </Text>

          <Text style={styles.sectionTitle}>{t("calendar.flight.events")}</Text>
          {events.map((event, i) => {
            const zone = zoneAt(event.position.lat, event.position.lon);
            return (
              <View key={`${event.kind}-${i}`} style={styles.event}>
                <Text style={styles.eventName}>{t(EVENT_KEYS[event.kind])}</Text>
                <View style={styles.eventBody}>
                  <Text style={styles.eventTime}>
                    {formatLocalTime(event.at, zone)} {formatOffset(event.at, zone)}
                  </Text>
                  <Text style={styles.eventSub}>
                    {event.position.lat.toFixed(1)}, {event.position.lon.toFixed(1)} ·{" "}
                    {t("calendar.flight.altitude")} {event.altitude.toFixed(1)}°
                  </Text>
                </View>
              </View>
            );
          })}
          {crossings.length === 0 ? (
            <Text style={styles.note}>{t("calendar.flight.none")}</Text>
          ) : null}
          {schedule.source === "network" ? (
            <Text style={styles.note}>{t("calendar.flight.disclaimer")}</Text>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * 把 `2026-12-15` + `16:30` 读成一个「挂空档」的瞬间（当作 UTC），
 * 之后再按机场时区平移。写错格式就返回 null —— 宁可报错，也不要拿
 * `Invalid Date` 往下算出一段负时长的航程。
 */
function parseClock(date: string, clock: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  const at = new Date(`${date.trim()}T${String(hour).padStart(2, "0")}:${m[2]}:00Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** 手填时刻要按机场当地时区还原成 UTC。 */
function offsetMinutes(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  manual: { gap: spacing.sm },
  grow: { flex: 1 },
  date: { width: 108 },
  time: { width: 76 },
  field: {
    backgroundColor: colors.paperSunken,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: 15,
  },
  button: {
    backgroundColor: colors.vermilion,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minWidth: 64,
    alignItems: "center",
  },
  buttonText: { color: colors.paperRaised, fontSize: 14, fontWeight: "500" },
  link: { ...type.small, color: colors.vermilion, paddingVertical: spacing.xs },
  error: { ...type.small, color: colors.danger },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  route: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  routeLine: { flex: 1, height: 1, backgroundColor: colors.border },
  airport: { ...type.heading },
  airportSub: { ...type.small, color: colors.inkFaint },
  right: { textAlign: "right" },
  meta: { ...type.small, color: colors.inkFaint, marginTop: spacing.sm },
  sectionTitle: { ...type.small, color: colors.inkFaint, marginTop: spacing.md },
  event: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  eventName: { ...type.small, color: colors.ink, width: 72 },
  eventBody: { flex: 1 },
  eventTime: { fontSize: 14, color: colors.ink, fontVariant: ["tabular-nums"] },
  eventSub: { ...type.small, color: colors.inkFaint },
  note: { ...type.small, color: colors.inkFaint, marginTop: spacing.sm },
});
