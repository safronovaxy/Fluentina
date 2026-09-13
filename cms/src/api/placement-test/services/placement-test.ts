const Mailjet = require('node-mailjet');

const MAILJET_NEWSLETTER_LIST_ID = 10537060;

/**
 * Subscribes the lead to a Mailjet contact list.
 * Uses 'addnoforce' to respect existing unsubscribes.
 */
async function subscribeToList(
  mailjet: any,
  email: string,
  firstName: string,
  lastName: string,
  listId: number,
) {
  // Ensure contact exists with name
  try {
    await mailjet.post('contact', { version: 'v3' }).request({
      Email: email,
      Name: `${firstName} ${lastName}`.trim(),
    });
  } catch (_) {
    // Contact may already exist — that's fine
  }

  // Add to list (no custom Properties — they must be pre-defined in Mailjet to avoid 400)
  await mailjet
    .post('contactslist', { version: 'v3' })
    .id(listId)
    .action('managecontact')
    .request({
      Email: email,
      Name: `${firstName} ${lastName}`.trim(),
      Action: 'addnoforce',
    });
}

export default {
  /**
   * Registers a placement test lead:
   * - Subscribes to the newsletter list (existing)
   * - Subscribes to the placement-test-specific list (new, if configured)
   */
  async registerLead({
    firstName,
    lastName,
    email,
    phone,
    language,
  }: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    language: string;
  }) {
    const mailjetApiKey = process.env.MAILJET_API_KEY;
    const mailjetSecretKey = process.env.MAILJET_SECRET_KEY;

    if (!mailjetApiKey || !mailjetSecretKey) {
      throw new Error('Mailjet credentials not configured');
    }

    const mailjet = Mailjet.apiConnect(mailjetApiKey, mailjetSecretKey);

    // Always subscribe to newsletter list
    await subscribeToList(mailjet, email, firstName, lastName, MAILJET_NEWSLETTER_LIST_ID);

    // Optionally subscribe to placement test list if configured
    const placementListId = parseInt(process.env.MAILJET_PLACEMENT_TEST_LIST_ID || '0', 10);
    if (placementListId > 0) {
      await subscribeToList(mailjet, email, firstName, lastName, placementListId);
      console.log(`Lead subscribed to placement test list ${placementListId}: ${email}`);
    }

    console.log(`Lead registered: ${email} (${language})`);
  },

  /**
   * Proxies the test generation request to the Fluentina app service.
   * Tests are pre-generated and stored in DB; this returns one from the pool.
   */
  async generateTest({
    language,
    nativeLanguage,
  }: {
    language: string;
    nativeLanguage: string;
  }): Promise<any> {
    const appUrl = process.env.WRITEWISE_APP_URL;
    if (!appUrl) {
      throw new Error('WRITEWISE_APP_URL environment variable not set');
    }

    const response = await fetch(`${appUrl}/api/public/placement-test/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, nativeLanguage }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`App service generate error (${response.status}): ${errorText}`);
    }

    return response.json();
  },

  /**
   * Proxies the evaluation request to the Fluentina app service.
   * Uses testId (from the generated PlacementTest.id) instead of the full test object.
   */
  async evaluateTest({
    testId,
    language,
    nativeLanguage,
    answers,
  }: {
    testId: string;
    language: string;
    nativeLanguage: string;
    answers: Record<string, string>;
  }): Promise<any> {
    const appUrl = process.env.WRITEWISE_APP_URL;
    if (!appUrl) {
      throw new Error('WRITEWISE_APP_URL environment variable not set');
    }

    const response = await fetch(`${appUrl}/api/public/placement-test/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId, language, nativeLanguage, answers }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`App service evaluate error (${response.status}): ${errorText}`);
    }

    return response.json();
  },
};
