import { Resend } from 'resend';

// Initialize Resend SDK using the environment variable
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

/**
 * Dispatches a welcome email to the registering user.
 * Falls back to console log simulation if Resend API key is not configured.
 */
export async function sendWelcomeEmail(username: string, email: string): Promise<void> {
  console.log(`📧 [Welcome Email] Preparing welcome template for ${username} <${email}>...`);

  const htmlContent = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #0A0A0B; color: #E2E8F0; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 16px;">
      <h2 style="color: #4edea3; font-size: 24px; font-weight: bold; margin-bottom: 20px;">Hi ${username},</h2>
      <p style="font-size: 16px; line-height: 1.6; color: #94A3B8;">Welcome to <strong>Aura Fitness</strong>—your AI-powered real-time biomechanical analysis platform. Your account is active and ready.</p>
      
      <p style="font-size: 16px; line-height: 1.6; color: #94A3B8; margin-top: 25px;">Log in to your dashboard today to access your performance suite:</p>
      
      <div style="margin-top: 20px; display: grid; gap: 15px;">
        <div style="padding: 15px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 10px; margin-bottom: 10px;">
          <strong style="color: #4edea3; display: block; margin-bottom: 5px;">🎥 Real-Time Biomechanical Tracking</strong>
          <span style="color: #94A3B8; font-size: 14px;">Low-latency joint mapping via your standard device camera.</span>
        </div>
        <div style="padding: 15px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 10px; margin-bottom: 10px;">
          <strong style="color: #4edea3; display: block; margin-bottom: 5px;">🔊 Dynamic Audio Coaching</strong>
          <span style="color: #94A3B8; font-size: 14px;">Live vocal feedback loops for immediate posture and form adjustments.</span>
        </div>
        <div style="padding: 15px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 10px; margin-bottom: 10px;">
          <strong style="color: #4edea3; display: block; margin-bottom: 5px;">📈 Personalized Analytics</strong>
          <span style="color: #94A3B8; font-size: 14px;">A clean, high-contrast workspace to track target thresholds and reps.</span>
        </div>
        <div style="padding: 15px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 10px; margin-bottom: 10px;">
          <strong style="color: #4edea3; display: block; margin-bottom: 5px;">🏆 Global Leaderboards</strong>
          <span style="color: #94A3B8; font-size: 14px;">Community standings sorted exclusively by comprehensive Form Accuracy Scores.</span>
        </div>
      </div>

      <div style="margin-top: 30px; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 20px;">
        <p style="font-size: 14px; color: #64748B; margin: 0;">Best regards,</p>
        <strong style="font-size: 16px; color: #4edea3; display: block; margin-top: 5px;">The Aura Fitness Team</strong>
      </div>
      
      <div style="margin-top: 25px; font-size: 11px; color: #475569; text-align: center;">
        Sent via Aura Onboarding System • ${new Date().toLocaleDateString()}
      </div>
    </div>
  `;

  if (!resend) {
    console.warn("⚠️ [Resend] RESEND_API_KEY environment variable is not configured. Falling back to local console mock.");
    console.log(`
======================================================================
📧 [MOCK SEND SIMULATION]
======================================================================
To: ${email}
Subject: Welcome to AURA FITNESS, ${username}!

${username}, your HTML welcome email is ready for Resend.
======================================================================
    `);
    return;
  }

  try {
    const response = await resend.emails.send({
      from: 'Aura Fitness <onboarding@resend.dev>',
      to: email,
      subject: `Welcome to AURA FITNESS, ${username}!`,
      html: htmlContent
    });
    
    if (response.error) {
      console.error(`❌ [Resend] API returned an error:`, response.error);
    } else {
      console.log(`✅ [Resend] Email successfully dispatched to ${email}. ID: ${response.data?.id}`);
    }
  } catch (err: any) {
    console.error(`❌ [Resend] SDK exception trying to send welcome email to ${email}:`, err);
  }
}

