const Mailjet = require('node-mailjet');

/**
 * Sends the detailed placement test report to the learner via Mailjet transactional email.
 */
export async function sendPlacementTestReport({
  email,
  firstName,
  language,
  results,
}: {
  email: string;
  firstName: string;
  language: string;
  results: any; // PlacementEvaluationResult from the app service
}) {
  const mailjetApiKey = process.env.MAILJET_API_KEY;
  const mailjetSecretKey = process.env.MAILJET_SECRET_KEY;
  const senderEmail = process.env.SUPPORT_EMAIL || 'hello@fluentina.com';

  if (!mailjetApiKey || !mailjetSecretKey) {
    console.error('Mailjet credentials not configured — skipping report email');
    return;
  }

  const mailjet = Mailjet.apiConnect(mailjetApiKey, mailjetSecretKey);

  const cefrColors: Record<string, string> = {
    A1: '#94a3b8',
    A2: '#60a5fa',
    B1: '#34d399',
    B2: '#2dd4bf',
    C1: '#a78bfa',
    C2: '#fbbf24',
  };
  const levelColor = cefrColors[results.cefrLevel] || '#7c3aed';

  const dimensionBars = Object.entries(results.dimensionScores || {})
    .map(([key, val]: [string, any]) => {
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      return `
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #374151; width: 100px;">${label}</td>
          <td style="padding: 6px 0;">
            <div style="background:#e5e7eb; border-radius:4px; height:10px; width:100%;">
              <div style="background:${levelColor}; border-radius:4px; height:10px; width:${val}%;"></div>
            </div>
          </td>
          <td style="padding: 6px 0 6px 8px; font-size: 13px; color:#6b7280; width:40px;">${val}/100</td>
        </tr>`;
    })
    .join('');

  const questionRows = (results.detailedAnalysis || [])
    .slice(0, 30) // cap at 30 for email length
    .map((qa: any, i: number) => {
      const correctIcon = qa.isCorrect === true ? '✅' : qa.isCorrect === false ? '❌' : '📝';
      return `
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 8px; font-size: 13px; color: #374151;">${i + 1}. ${qa.taskType.replace(/_/g, ' ')}</td>
          <td style="padding: 8px; font-size: 13px; text-align:center;">${correctIcon}</td>
          <td style="padding: 8px; font-size: 13px; color: #6b7280;">${qa.feedback || ''}</td>
        </tr>`;
    })
    .join('');

  const strongAreasHtml = (results.strongAreas || [])
    .map((a: string) => `<li style="margin-bottom:6px; color:#059669;">✅ ${a}</li>`)
    .join('');

  const improvementAreasHtml = (results.improvementAreas || [])
    .map((a: string) => `<li style="margin-bottom:6px; color:#d97706;">⚠️ ${a}</li>`)
    .join('');

  const appUrl = process.env.WRITEWISE_APP_URL || 'https://app.fluentina.com';
  const signupUrl = `${appUrl}?mode=signup&level=${results.cefrLevel}&lang=${encodeURIComponent(language)}`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Fluentina Language Assessment Results</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f9fafb; margin:0; padding:0;">
  <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; margin-top:24px; margin-bottom:24px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%); padding: 40px 32px; text-align: center;">
      <h1 style="color:white; margin:0; font-size:28px; font-weight:700;">Fluentina</h1>
      <p style="color:rgba(255,255,255,0.85); margin:8px 0 0; font-size:16px;">Language Assessment Report</p>
    </div>

    <!-- Greeting -->
    <div style="padding: 32px 32px 0;">
      <p style="font-size:18px; color:#111827; margin:0 0 8px;">Hi ${firstName},</p>
      <p style="font-size:15px; color:#4b5563; margin:0 0 24px;">
        Your ${language} placement test results are in! Here's your comprehensive assessment.
      </p>
    </div>

    <!-- CEFR Level Badge -->
    <div style="padding: 0 32px 24px;">
      <div style="background:#f8f7ff; border: 2px solid ${levelColor}; border-radius:12px; padding:24px; text-align:center;">
        <div style="display:inline-block; background:${levelColor}; color:white; font-size:32px; font-weight:800; padding:12px 28px; border-radius:8px; letter-spacing:2px;">
          ${results.cefrLevel}
        </div>
        <p style="font-size:20px; color:#111827; margin:12px 0 4px; font-weight:600;">Your ${language} Level</p>
        <p style="font-size:14px; color:#6b7280; margin:0;">Overall Score: ${results.overallScore}/100</p>
      </div>
    </div>

    <!-- Summary -->
    <div style="padding: 0 32px 24px;">
      <h2 style="font-size:16px; color:#111827; margin:0 0 12px; font-weight:600;">Assessment Summary</h2>
      <p style="font-size:15px; color:#374151; line-height:1.6; margin:0; background:#f8f7ff; padding:16px; border-radius:8px; border-left:3px solid ${levelColor};">
        ${results.highLevelSummary}
      </p>
    </div>

    <!-- Strong Areas & Improvement Areas -->
    <div style="padding: 0 32px 24px;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="width:50%; vertical-align:top; padding-right:12px;">
            <h3 style="font-size:14px; color:#111827; margin:0 0 10px; font-weight:600;">Your Strengths</h3>
            <ul style="margin:0; padding-left:0; list-style:none;">
              ${strongAreasHtml}
            </ul>
          </td>
          <td style="width:50%; vertical-align:top; padding-left:12px;">
            <h3 style="font-size:14px; color:#111827; margin:0 0 10px; font-weight:600;">Focus Areas</h3>
            <ul style="margin:0; padding-left:0; list-style:none;">
              ${improvementAreasHtml}
            </ul>
          </td>
        </tr>
      </table>
    </div>

    <!-- Skill Dimensions -->
    <div style="padding: 0 32px 24px;">
      <h2 style="font-size:16px; color:#111827; margin:0 0 12px; font-weight:600;">Skill Breakdown</h2>
      <table style="width:100%; border-collapse:collapse;">
        ${dimensionBars}
      </table>
    </div>

    <!-- Recommendations -->
    <div style="padding: 0 32px 24px;">
      <h2 style="font-size:16px; color:#111827; margin:0 0 12px; font-weight:600;">Personalized Recommendations</h2>
      <p style="font-size:15px; color:#374151; line-height:1.6; margin:0;">
        ${results.recommendations}
      </p>
    </div>

    <!-- Detailed Question Analysis -->
    <div style="padding: 0 32px 24px;">
      <h2 style="font-size:16px; color:#111827; margin:0 0 12px; font-weight:600;">Detailed Question Analysis</h2>
      <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 8px; text-align:left; font-size:13px; color:#6b7280; font-weight:600;">Question</th>
            <th style="padding:10px 8px; text-align:center; font-size:13px; color:#6b7280; font-weight:600; width:40px;">Result</th>
            <th style="padding:10px 8px; text-align:left; font-size:13px; color:#6b7280; font-weight:600;">Feedback</th>
          </tr>
        </thead>
        <tbody>
          ${questionRows}
        </tbody>
      </table>
    </div>

    <!-- CTA -->
    <div style="padding: 0 32px 40px; text-align:center;">
      <div style="background: linear-gradient(135deg, #7c3aed10 0%, #3b82f610 100%); border-radius:12px; padding:28px;">
        <h3 style="font-size:18px; color:#111827; margin:0 0 8px;">Ready to level up your ${language}?</h3>
        <p style="font-size:14px; color:#6b7280; margin:0 0 20px;">
          Start your free Fluentina trial and get personalized AI-powered writing exercises tailored to your ${results.cefrLevel} level.
        </p>
        <a href="${signupUrl}" style="display:inline-block; background: linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%); color:white; text-decoration:none; padding:14px 32px; border-radius:8px; font-size:16px; font-weight:600;">
          Start Free Trial →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f3f4f6; padding:20px 32px; text-align:center;">
      <p style="font-size:13px; color:#9ca3af; margin:0;">
        © 2025 Fluentina · <a href="https://fluentina.com" style="color:#7c3aed; text-decoration:none;">fluentina.com</a>
      </p>
      <p style="font-size:12px; color:#9ca3af; margin:8px 0 0;">
        You received this email because you took the Fluentina placement test.
      </p>
    </div>

  </div>
</body>
</html>`;

  const textBody = `
Hi ${firstName},

Your Fluentina ${language} Assessment Results are ready!

CEFR Level: ${results.cefrLevel}
Overall Score: ${results.overallScore}/100

${results.highLevelSummary}

Strong Areas:
${(results.strongAreas || []).map((a: string) => `• ${a}`).join('\n')}

Focus Areas:
${(results.improvementAreas || []).map((a: string) => `• ${a}`).join('\n')}

Skill Scores:
${Object.entries(results.dimensionScores || {}).map(([k, v]: [string, any]) => `• ${k}: ${v}/100`).join('\n')}

Recommendations:
${results.recommendations}

Start your free trial at: ${signupUrl}

Fluentina — fluentina.com
  `.trim();

  await mailjet.post('send', { version: 'v3.1' }).request({
    Messages: [
      {
        From: {
          Email: senderEmail,
          Name: 'Fluentina Language Assessment',
        },
        To: [{ Email: email, Name: firstName }],
        Subject: `Your ${language} Level: ${results.cefrLevel} — Fluentina Assessment Results`,
        TextPart: textBody,
        HTMLPart: htmlBody,
      },
    ],
  });

  console.log(`Placement test report sent to ${email} (${results.cefrLevel})`);
}
