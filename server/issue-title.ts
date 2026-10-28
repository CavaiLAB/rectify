/** 本地抽取式摘要：保留原意，不调用外部模型，也不读取附件内容。 */
export function summarizeIssueTitle(description: string): string {
  const normalized = description
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\ufeff]/g, "")
    .trim();
  const candidates = normalized
    .split(/[\n。！？!?]+|\.(?:\s|$)/u)
    .map((line) =>
      line
        .replace(/^\s*(?:#{1,6}\s*|[-*•>]\s*|\d+[、.)．]\s*)/u, "")
        .replace(/^(?:(?:你好|您好|大家好|请问)[，,：:\s]*)+/u, "")
        .replace(
          /^(?:问题描述|反馈内容|实际结果|实际情况|现象|需求描述|描述)[：:\s]+/u,
          "",
        )
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter(
      (line) =>
        line &&
        !/^(?:问题如下|复现步骤|操作步骤|预期结果|期望结果|截图如下)[：:]?$/u.test(
          line,
        ),
    );
  const problem =
    /失败|报错|错误|异常|无法|不能|没有反应|不显示|显示不|不完整|不一致|不生效|不可用|不支持|未保存|未显示|丢失|缺失|闪退|卡住|卡顿|超时|空白|重复|希望|建议|增加|新增|优化|\b(?:error|fail(?:ed|s|ure)?|cannot|broken|missing|crash|request)\b/iu;
  const sentence =
    (candidates.find((line) => problem.test(line)) ??
      candidates[0] ??
      normalized.replace(/\s+/gu, " ")) ||
    "问题反馈";
  const clean =
    sentence.replace(/[，,；;：:。.!?！？\s]+$/gu, "") || "问题反馈";
  const segments = Array.from(
    new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(clean),
    (part) => part.segment,
  );
  if (segments.length <= 48 && clean.length <= 120) return clean;
  let result = "";
  for (const segment of segments.slice(0, 47)) {
    if (result.length + segment.length > 119) break;
    result += segment;
  }
  return result.trimEnd() + "…";
}
