const Mailjet = require('node-mailjet');

const MAILJET_LIST_ID = 10537060; // Fluentina Newsletter list

export default {
  async addSubscriber(email: string) {
    const mailjetApiKey = process.env.MAILJET_API_KEY;
    const mailjetSecretKey = process.env.MAILJET_SECRET_KEY;

    if (!mailjetApiKey || !mailjetSecretKey) {
      console.error('Mailjet credentials not configured');
      throw new Error('Email service not configured');
    }

    const mailjet = Mailjet.apiConnect(mailjetApiKey, mailjetSecretKey);

    // POST /v3/REST/contactslist/{id}/managecontact
    // Creates the contact if new, adds to list, respects previous unsubscribes (addnoforce)
    const result = await mailjet
      .post('contactslist', { version: 'v3' })
      .id(MAILJET_LIST_ID)
      .action('managecontact')
      .request({
        Email: email,
        Action: 'addnoforce',
      });

    console.log(`Newsletter subscription added: ${email}`, result.body);
  },
};
