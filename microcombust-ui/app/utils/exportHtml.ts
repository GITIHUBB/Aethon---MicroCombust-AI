export interface ExecutiveSummaryReport {
  telemetry: {
    oxygen: number;
    airflow: number;
    gravity: string;
    fuel: string;
    pressure: number;
  };
  risk: {
    material: string;
    score: number;
    tier: string;
  } | null;
  answer: string;
  references: Array<{ title: string; url?: string }>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function exportHtml(report: ExecutiveSummaryReport): void {
  const telemetry = report.telemetry;
  const answerBody = report.answer
    .split(/^#{1,6}\s*📚 Referenced NASA Papers.*$/m, 1)[0]
    .trim();
  const answer = escapeHtml(answerBody)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  const references = report.references.length
    ? report.references
        .map((reference) => {
          const title = escapeHtml(reference.title);
          const safeUrl = reference.url ? safeHttpUrl(reference.url) : null;
          return safeUrl
            ? `<li><a href="${escapeHtml(safeUrl)}">${title}</a></li>`
            : `<li>${title}</li>`;
        })
        .join('')
    : '<li>No papers were referenced in the latest answer.</li>';
  const risk = report.risk
    ? `${escapeHtml(report.risk.material)} — ${Math.round(report.risk.score * 100)}/100 (${escapeHtml(report.risk.tier)})`
    : 'No risk score available';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NASA MicroCombust Analysis</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #0B0F19; color: #e2e8f0; }
    body { max-width: 960px; margin: 0 auto; padding: 40px 24px; line-height: 1.65; }
    header { display: flex; align-items: center; gap: 16px; padding-bottom: 24px; border-bottom: 1px solid #1e293b; }
    .logo { width: 58px; height: 58px; flex: none; }
    h1 { margin: 0; color: #f8fafc; font-size: 1.6rem; }
    .subtitle { color: #94a3b8; margin: 4px 0 0; }
    section { margin-top: 28px; padding: 24px; border: 1px solid #1e293b; border-radius: 16px; background: #0f172ab3; }
    h2 { margin: 0 0 18px; color: #38BDF8; font-size: 1rem; letter-spacing: .04em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .metric { padding: 14px; border-radius: 12px; background: #0b0f19; border: 1px solid #1e293b; }
    .label { display: block; color: #94a3b8; font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; }
    .value { display: block; margin-top: 5px; color: #f8fafc; font-weight: 650; }
    .risk { color: #F97316; }
    .answer { white-space: normal; }
    li { margin: 8px 0; }
    a { color: #38BDF8; }
    footer { margin-top: 28px; color: #64748b; font-size: .8rem; }
    @media print { :root { color-scheme: light; background: white; color: #0f172a; } body { padding: 0; } section { break-inside: avoid; } }
  </style>
</head>
<body>
  <header>
    <svg class="logo" viewBox="0 0 100 100" role="img" aria-label="NASA">
      <circle cx="50" cy="50" r="48" fill="#0b3d91"/>
      <path d="M13 68 84 28M18 33c22 28 44 38 68 35" fill="none" stroke="#fff" stroke-width="2.5"/>
      <path d="M20 78 79 19" fill="none" stroke="#fc3d21" stroke-width="3"/>
      <text x="50" y="59" text-anchor="middle" fill="#fff" font-size="27" font-style="italic" font-weight="700">NASA</text>
    </svg>
    <div>
      <h1>MicroCombust Analysis</h1>
      <p class="subtitle">AETHON · NASA Microgravity Combustion Research</p>
    </div>
  </header>
  <section>
    <h2>TELEMETRY PARAMETERS</h2>
    <div class="grid">
      <div class="metric"><span class="label">Oxygen</span><span class="value">${escapeHtml(String(telemetry.oxygen))}%</span></div>
      <div class="metric"><span class="label">Airflow</span><span class="value">${(telemetry.airflow / 100).toFixed(3)} m/s</span></div>
      <div class="metric"><span class="label">Gravity</span><span class="value">${escapeHtml(telemetry.gravity)}</span></div>
      <div class="metric"><span class="label">Fuel Material</span><span class="value">${escapeHtml(telemetry.fuel)}</span></div>
      <div class="metric"><span class="label">Pressure</span><span class="value">${escapeHtml(String(telemetry.pressure))} kPa</span></div>
    </div>
  </section>
  <section>
    <h2>FLAMMABILITY RISK SCORE</h2>
    <p class="value risk">${risk}</p>
  </section>
  <section>
    <h2>RAG ANALYSIS</h2>
    <div class="answer">${answer || 'No analysis is available yet.'}</div>
  </section>
  <section>
    <h2>REFERENCED PAPERS &amp; DATASETS</h2>
    <ol>${references}</ol>
  </section>
  <footer>Generated ${new Date().toLocaleString()} · AETHON MicroCombust</footer>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'NASA_MicroCombust_Analysis.html';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
