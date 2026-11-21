
import { supabase, supabaseConfigured } from "./supabase.js";

function requireSupabase() {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase credentials have not been configured yet.");
  }
  return supabase;
}

// SIGNUP: Email and password (single step, no email round-trip).
// Returns { user, session }. session is null when email confirmation is on.
export async function signUpWithPassword(email, password) {
  const client = requireSupabase();

  const { data, error } = await client.auth.signUp({
    email: email.trim().toLowerCase(),
    password
  });

  if (error) throw error;
  return data;
}

// STEP 1: Send email OTP during registration.
export async function sendSignupOTP(email) {
  const client = requireSupabase();

  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true
    }
  });

  if (error) throw error;
  return true;
}

// STEP 2: Verify registration OTP.
export async function verifySignupOTP(email, token) {
  const client = requireSupabase();

  const { data, error } = await client.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email"
  });

  if (error) throw error;
  return data;
}

// STEP 3: Set password after email verification.
export async function setAccountPassword(password) {
  const client = requireSupabase();

  const { data, error } = await client.auth.updateUser({
    password
  });

  if (error) throw error;
  return data;
}

// LOGIN: Email and password.
export async function loginUser(email, password) {
  const client = requireSupabase();

  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password
  });

  if (error) throw error;
  return data;
}

// FORGOT PASSWORD: Request recovery OTP.
export async function sendPasswordResetOTP(email) {
  const client = requireSupabase();

  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: false
    }
  });

  if (error) throw error;
  return true;
}

// Verify recovery OTP.
export async function verifyPasswordResetOTP(email, token) {
  const client = requireSupabase();

  const { data, error } = await client.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email"
  });

  if (error) throw error;
  return data;
}

// Set new password after recovery verification.
export async function resetPassword(newPassword) {
  const client = requireSupabase();

  const { data, error } = await client.auth.updateUser({
    password: newPassword
  });

  if (error) throw error;
  return data;
}

// Get current authenticated user.
export async function getCurrentUser() {
  const client = requireSupabase();

  const { data, error } = await client.auth.getUser();

  if (error) throw error;
  return data.user;
}

// LOGOUT.
export async function logoutUser() {
  const client = requireSupabase();

  const { error } = await client.auth.signOut();

  if (error) throw error;
}

// Alias used by the signup page script.
export const registerWithEmail = signUpWithPassword;

// GOOGLE OAUTH: redirects the browser to Google and back to the site.
// The landing page decides where the user goes next: auth-callback.html checks
// whether this account is brand new or already has a profile. That is what makes
// "Continue with Google" log an existing user straight into their account
// instead of dragging them through signup again.
export async function signInWithGoogle(redirectTo) {
  const client = requireSupabase();

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo || window.location.origin + "/pages/auth-callback.html"
    }
  });

  if (error) throw error;
  return data;
}

// Where a signed-in user actually belongs, based on their own data.
// Single source of truth for redirect decisions after login / OAuth.
export async function resolveLanding(user) {
  const client = requireSupabase();

  if (!user) return "login.html";

  const [{ data: profile }, { data: interests }] = await Promise.all([
    client.from("profiles").select("avatar_url, onboarding_completed, hall").eq("id", user.id).maybeSingle(),
    client.from("user_interests").select("interest_id").eq("user_id", user.id)
  ]);

  if (!profile) return "signup-details.html";
  if (!profile.avatar_url) return "profile.html#photo";
  if (!profile.onboarding_completed || (interests || []).length < 5) {
    return "signup-interests.html";
  }

  return "discover.html";
}

// PROFILE: create or update the signed-in user's profile row.
export async function saveUserProfile(profile = {}) {
  const client = requireSupabase();
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("You need to be signed in to save your profile.");
  }

  const { age } = profile;
  const birthYear =
    Number.isInteger(age) && age > 0 ? new Date().getFullYear() - age : null;

  const payload = {
    id: user.id,
    full_name: profile.full_name,
    nickname: profile.nickname || null,
    age: Number.isInteger(age) ? age : null,
    birth_year: birthYear,
    gender: profile.gender || null,
    hall: profile.hall,
    faculty: profile.faculty || null,
    department: profile.department || null,
    level: profile.level || null,
    bio: profile.bio || undefined,
    avatar_url: profile.avatar_url || undefined
  };

  Object.keys(payload).forEach(key => {
    if (payload[key] === undefined) delete payload[key];
  });

  const { data, error } = await client
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// PROFILE: read the signed-in user's profile row (null when none yet).
export async function getUserProfile() {
  const client = requireSupabase();
  const user = await getCurrentUser();

  if (!user) return null;

  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}
