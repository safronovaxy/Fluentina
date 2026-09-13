import { sendPlacementTestReport } from '../services/email-report';

export default {
  /**
   * POST /api/placement-test/register
   *
   * Captures lead information and subscribes to Mailjet lists.
   * Returns a sessionId used to correlate generate and evaluate calls.
   */
  async register(ctx) {
    try {
      const { firstName, lastName, email, phone, language, consent } = ctx.request.body;

      if (!firstName || !lastName || !email || !language) {
        return ctx.badRequest('Missing required fields: firstName, lastName, email, language');
      }

      if (!consent) {
        return ctx.badRequest('User consent is required');
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return ctx.badRequest('Invalid email address');
      }

      await strapi.service('api::placement-test.placement-test').registerLead({
        firstName,
        lastName,
        email,
        phone: phone || undefined,
        language,
      });

      // Generate a session ID that ties the lead to the test session
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      return ctx.send({
        success: true,
        sessionId,
      });
    } catch (error) {
      console.error('Placement test registration error:', error);
      return ctx.internalServerError('Failed to register for placement test');
    }
  },

  /**
   * POST /api/placement-test/generate
   *
   * Proxies test generation to the Fluentina app service.
   */
  async generate(ctx) {
    try {
      const { language, nativeLanguage } = ctx.request.body;

      if (!language || !nativeLanguage) {
        return ctx.badRequest('Missing required fields: language, nativeLanguage');
      }

      const test = await strapi.service('api::placement-test.placement-test').generateTest({
        language,
        nativeLanguage,
      });

      return ctx.send(test);
    } catch (error) {
      console.error('Placement test generation error:', error);
      return ctx.internalServerError('Failed to generate placement test');
    }
  },

  /**
   * POST /api/placement-test/evaluate
   *
   * Proxies evaluation to the Fluentina app service,
   * then sends the detailed report email to the learner.
   */
  async evaluate(ctx) {
    try {
      const { testId, language, nativeLanguage, answers, email, firstName } = ctx.request.body;

      if (!testId || !language || !nativeLanguage || !answers) {
        return ctx.badRequest('Missing required fields: testId, language, nativeLanguage, answers');
      }

      const results = await strapi.service('api::placement-test.placement-test').evaluateTest({
        testId,
        language,
        nativeLanguage,
        answers,
      });

      // Send detailed report email in the background (don't block the response)
      if (email && firstName) {
        sendPlacementTestReport({
          email,
          firstName,
          language,
          results,
        }).catch((err) => {
          console.error('Failed to send placement test report email:', err);
        });
      }

      return ctx.send(results);
    } catch (error) {
      console.error('Placement test evaluation error:', error);
      return ctx.internalServerError('Failed to evaluate placement test');
    }
  },
};
