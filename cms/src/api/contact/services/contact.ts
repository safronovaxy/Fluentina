const Mailjet = require('node-mailjet');

export default {
  async sendContactEmail({ name, email, subject, message }) {
    const mailjetApiKey = process.env.MAILJET_API_KEY;
    const mailjetSecretKey = process.env.MAILJET_SECRET_KEY;
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@fluentina.com';

    if (!mailjetApiKey || !mailjetSecretKey) {
      console.error('Mailjet credentials not configured');
      throw new Error('Email service not configured');
    }

    const mailjet = Mailjet.apiConnect(mailjetApiKey, mailjetSecretKey);

    const subjectLabels = {
      general: 'General Inquiry',
      support: 'Technical Support',
      feedback: 'Feedback & Suggestions',
      'freelancer-apply': 'Freelance Tutor Beta Application',
    };

    const subjectLabel = subjectLabels[subject] || subject;

    try {
      const result = await mailjet.post('send', { version: 'v3.1' }).request({
        Messages: [
          {
            From: {
              Email: supportEmail,
              Name: 'Fluentina Contact Form',
            },
            To: [
              {
                Email: supportEmail,
                Name: 'Fluentina Support',
              },
            ],
            Subject: `[${subjectLabel}] Contact Form Submission from ${name}`,
            TextPart: `
New contact form submission:

From: ${name} (${email})
Subject: ${subjectLabel}

Message:
${message}

---
Reply to: ${email}
            `,
            HTMLPart: `
              <h2>New Contact Form Submission</h2>
              <p><strong>From:</strong> ${name} (${email})</p>
              <p><strong>Subject:</strong> ${subjectLabel}</p>
              <h3>Message:</h3>
              <p>${message.replace(/\n/g, '<br>')}</p>
              <hr>
              <p><small>Reply to: <a href="mailto:${email}">${email}</a></small></p>
            `,
            ReplyTo: {
              Email: email,
              Name: name,
            },
          },
        ],
      });

      console.log('Email sent successfully:', result.body);
      return result;
    } catch (error) {
      console.error('Mailjet error:', error.statusCode, error.message);
      throw error;
    }
  },
};
