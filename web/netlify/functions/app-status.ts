import type { Config } from "@netlify/functions";

/**
 * Unauthenticated endpoint that returns whether the app has been configured.
 * Used by the frontend to decide whether to show InitialSetupPage or LoginPage.
 */
export default async () => {
  return new Response(
    JSON.stringify({
      configured: !!process.env.JWT_SECRET,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};

export const config: Config = { path: ["/api/app-status"] };
