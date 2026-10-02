import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { state, isBackendConfigured } from './state.js';

export async function initBackend() {
  if (!isBackendConfigured()) return null;

  state.supabase = createClient(
    state.config.SUPABASE_URL,
    state.config.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  const { data: { session } } = await state.supabase.auth.getSession();
  state.user = session?.user ?? null;
  if (state.user) await loadProfile();

  state.supabase.auth.onAuthStateChange(async (_event, sessionNow) => {
    state.user = sessionNow?.user ?? null;
    state.profile = null;
    if (state.user) await loadProfile();
    window.dispatchEvent(new CustomEvent('studylibrary:auth-changed'));
  });

  return state.supabase;
}

export async function loadProfile() {
  if (!state.supabase || !state.user) return null;
  const { data, error } = await state.supabase
    .from('profiles')
    .select('id, display_name, avatar_url, bio')
    .eq('id', state.user.id)
    .maybeSingle();
  if (!error) state.profile = data;
  return data;
}

export async function signInWithGoogle() {
  if (!state.supabase) throw new Error('Backend non configurato');
  const redirectTo = state.config.APP_URL || window.location.origin;
  const { error } = await state.supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
  if (error) throw error;
}

export async function signOut() {
  if (!state.supabase) return;
  const { error } = await state.supabase.auth.signOut();
  if (error) throw error;
}

export async function fetchPublicCourses() {
  if (!state.supabase) return [];
  const { data, error } = await state.supabase
    .from('courses')
    .select('id, owner_id, slug, title, description, tags, is_public, course_json, created_at, updated_at')
    .eq('is_public', true)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  state.remoteCourses = (data || []).map(row => ({
    ...row.course_json,
    _db: { id: row.id, owner_id: row.owner_id, updated_at: row.updated_at }
  }));
  return state.remoteCourses;
}

export async function fetchMyCourses() {
  if (!state.supabase || !state.user) return [];
  const { data, error } = await state.supabase
    .from('courses')
    .select('id, owner_id, slug, title, description, tags, is_public, course_json, created_at, updated_at')
    .eq('owner_id', state.user.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({ ...row.course_json, _db: { id: row.id, owner_id: row.owner_id, updated_at: row.updated_at } }));
}

export async function saveCourse(course, publish = false) {
  if (!state.supabase || !state.user) throw new Error('Accedi per salvare o pubblicare');
  const payload = {
    owner_id: state.user.id,
    slug: course.slug,
    title: course.title,
    description: course.description || '',
    tags: course.tags || [],
    is_public: Boolean(publish),
    course_json: { ...course, visibility: publish ? 'public' : 'private' }
  };

  const { data, error } = await state.supabase
    .from('courses')
    .upsert(payload, { onConflict: 'owner_id,slug' })
    .select('id, slug, is_public, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function getDiscussion(targetKind, targetKey) {
  if (!state.supabase) return { comments: [], ratings: [], average: null, count: 0, mine: null };

  const [commentsRes, ratingsRes] = await Promise.all([
    state.supabase
      .from('comments')
      .select('id, body, created_at, user_id, profiles(display_name, avatar_url)')
      .eq('target_kind', targetKind)
      .eq('target_key', targetKey)
      .order('created_at', { ascending: false })
      .limit(50),
    state.supabase
      .from('ratings')
      .select('user_id, rating')
      .eq('target_kind', targetKind)
      .eq('target_key', targetKey)
  ]);

  if (commentsRes.error) throw commentsRes.error;
  if (ratingsRes.error) throw ratingsRes.error;

  const ratings = ratingsRes.data || [];
  const average = ratings.length ? ratings.reduce((a, r) => a + r.rating, 0) / ratings.length : null;
  const mine = state.user ? ratings.find(r => r.user_id === state.user.id)?.rating ?? null : null;
  return { comments: commentsRes.data || [], ratings, average, count: ratings.length, mine };
}

export async function addComment(targetKind, targetKey, body) {
  if (!state.supabase || !state.user) throw new Error('Accedi per commentare');
  const clean = body.trim();
  if (!clean) throw new Error('Scrivi un commento');
  const { error } = await state.supabase.from('comments').insert({
    user_id: state.user.id,
    target_kind: targetKind,
    target_key: targetKey,
    body: clean
  });
  if (error) throw error;
}

export async function setRating(targetKind, targetKey, rating) {
  if (!state.supabase || !state.user) throw new Error('Accedi per lasciare una valutazione');
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('Valutazione non valida');
  const { error } = await state.supabase.from('ratings').upsert({
    user_id: state.user.id,
    target_kind: targetKind,
    target_key: targetKey,
    rating: value
  }, { onConflict: 'user_id,target_kind,target_key' });
  if (error) throw error;
}
