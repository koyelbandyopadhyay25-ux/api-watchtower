export function App() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-800">
      <header className="border-b border-stone-200 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <span className="text-sm font-semibold tracking-tight">API Watchtower</span>
          <span className="font-mono text-xs text-stone-500">Local development</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-xs font-medium uppercase tracking-wider text-stone-500">Project setup</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Application foundation</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-stone-600">
          The frontend and API are configured for development. Endpoint monitoring
          and response-schema detection will be added in a later phase.
        </p>
        <div className="mt-8 rounded-sm border border-stone-200 bg-white p-5 text-sm">
          <h2 className="font-medium">API health endpoint</h2>
          <p className="mt-2 leading-6 text-stone-600">
            Open <a className="font-mono underline underline-offset-4" href="/api/health">/api/health</a> to
            check the running API through the development proxy.
          </p>
          <p className="mt-2 text-xs text-stone-500">No monitoring activity is collected yet.</p>
        </div>
      </main>
    </div>
  );
}
