const runtimeConfig = typeof window !== 'undefined' ? (window.STUDYLIBRARY_CONFIG || {}) : {};

export const state = {
  config: runtimeConfig,
  supabase: null,
  user: null,
  profile: null,
  staticCatalogs: [],
  remoteCatalogs: [],
  ratings: new Map(),
  comments: new Map(),
  bookmarks: [],
  favorites: [],
  savedLoadedFor: null,
  activeCatalog: null,
  activeLibrary: null,
  activeLesson: null,
  activeTopic: null
};

export const isBackendConfigured = () => Boolean(
  state.config?.SUPABASE_URL &&
  (state.config?.SUPABASE_PUBLISHABLE_KEY || state.config?.SUPABASE_ANON_KEY)
);
