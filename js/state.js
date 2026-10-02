export const state = {
  config: window.STUDYLIBRARY_CONFIG || {},
  supabase: null,
  user: null,
  profile: null,
  staticCatalogs: [],
  remoteCatalogs: [],
  ratings: new Map(),
  comments: new Map(),
  activeCatalog: null,
  activeLibrary: null,
  activeLesson: null,
  activeTopic: null
};

export const isBackendConfigured = () => Boolean(
  state.config?.SUPABASE_URL && state.config?.SUPABASE_ANON_KEY
);
