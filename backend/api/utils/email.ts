/**
 * Simulated email sender utility.
 * In a production environment, this would integrate with Resend, SendGrid, or nodemailer.
 */
export function sendWelcomeEmail(username: string, email: string): void {
  console.log(`
======================================================================
📧 [MOCK MAILER] DISPATCHING WELCOME EMAIL
======================================================================
To: ${email}
Subject: Welcome to AURA FITNESS, ${username}!
Timestamp: ${new Date().toISOString()}

Hello ${username},

Welcome to AURA FITNESS — your AI-Powered Smart Form Coach! 🏋️‍♂️

Your account has been successfully created. You can now access:
- Real-time biomechanical camera tracking and joint analysis
- Instant voice coaching audio warnings and hints during reps
- Personal bento card dashboard settings and customized rep targets
- Public leaderboard rankings sorted by overall form accuracy

Start your physical optimization journey today!

Best regards,
The AURA FITNESS Team
======================================================================
  `);
}
