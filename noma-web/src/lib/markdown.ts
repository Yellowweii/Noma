const FENCED_CODE_BLOCK = /(```[\s\S]*?```)/g;

/**
 * LLM 常在「比如：」后缩进 4 空格再写 `- item`，CommonMark 不会识别为列表。
 * 渲染前去掉列表行上多余的 leading spaces（跳过 fenced code block）。
 */
export function normalizeAssistantMarkdown(content: string): string {
  return content
    .split(FENCED_CODE_BLOCK)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment
        .split("\n")
        .map((line) => line.replace(/^ {4,}(?=[-*+]\s)/, ""))
        .join("\n");
    })
    .join("");
}
