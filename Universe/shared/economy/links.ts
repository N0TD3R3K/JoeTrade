const loopback = (host: string) =>
  ["127.0.0.1", "localhost", "[::1]"].includes(host);
export function bankSiteUrl(host: string, member?: "alice" | "bob") {
  return loopback(host)
    ? `http://127.0.0.1:4180/${member ? "?member=" + member : ""}`
    : "https://bank.joe-univer.se/";
}
export function stockAccountUrl(host: string, member?: "alice" | "bob") {
  return loopback(host)
    ? `http://127.0.0.1:4173/account${member ? "?member=" + member : ""}`
    : "https://stock.joe-univer.se/account";
}
