window.synapseReady = fetch('/api/config')
  .then((response) => {
    if (!response.ok) throw new Error('Configuration could not be loaded.');
    return response.json();
  })
  .then((config) => {
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('Supabase is not configured.');
    window.supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    return window.supabaseClient;
  });
