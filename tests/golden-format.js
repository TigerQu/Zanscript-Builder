// Formats one generated bundle (refreshAll._latestBundle) as the text stored in tests/golden/*.txt.
// Kept as a single function expression so the test runner can evaluate it inside the page.
(bundle) => {
  const parts = [];
  for (const step of [1, 2, 3, 4]) {
    parts.push(`===== ${bundle[step].filename} =====\n${bundle[step].code}\n`);
  }
  parts.push(`===== README_STEPS.txt =====\n${bundle.readme}\n`);
  return parts.join("\n");
}
