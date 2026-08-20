/**
 * Liveness probe for the serverless runtime.
 *
 * Exists to answer one question when a deployment misbehaves: are Vercel
 * functions running here at all? A 404 on this route means none of `api/` was
 * deployed, which is a project-configuration problem; JSON means the runtime is
 * fine and any proxy trouble is the proxy's own.
 */
export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    service: 'usa-budget-copilot',
    runtime: `node ${process.versions.node}`,
    routes: ['/api/health', '/api/usaspending/<path>', '/api/fiscaldata/<path>'],
    time: new Date().toISOString(),
  });
}
