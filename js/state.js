export const state = {
  config: window.STUDYLIBRARY_CONFIG || {},
  supabase: null,
  user: null,
  profile: null,
  staticCourses: [],
  remoteCourses: [],
  ratings: new Map(),
  comments: new Map(),
  activeCourse: null,
  activeTopic: null
};

export const isBackendConfigured = () => Boolean(
  state.config?.SUPABASE_URL && state.config?.SUPABASE_ANON_KEY
);
