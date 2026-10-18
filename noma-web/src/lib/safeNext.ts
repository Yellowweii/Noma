export function safeNextPath(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value)
    ? value : "/agent";
}
