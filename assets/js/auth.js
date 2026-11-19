
import { supabase, supabaseConfigured } from "./supabase.js";

function requireSupabase() {
  if (!supabaseConfigured || !supabase) {
<<<<<<< HEAD
    throw new Error("Supabase credentials have not been configured.");
=======
    throw new Error("Supabase credentials have not been configured yet.");
>>>>>>> origin/main
  }
  return supabase;
}

<<<<<<< HEAD
// EMAIL SIGNUP WITH VERIFICATION LINK
export async function registerWithEmail(email, password) {
  const client = requireSupabase();

  const { data, error } = await client.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/pages/signup-details.html`
=======
// STEP 1: Send email OTP during registration.
export async function sendSignupOTP(email) {
  const client = requireSupabase();

  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true
>>>>>>> origin/main
    }
  });

  if (error) throw error;
<<<<<<< HEAD
  return data;
}

// LEGACY EMAIL OTP
export async function sendSignupOTP(email) {
  const { error } = await requireSupabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true }
  });

  if (error) throw error;
  return true;
}

export async function verifySignupOTP(email, token) {
  const { data, error } = await requireSupabase().auth.verifyOtp({
=======
  return true;
}

// STEP 2: Verify registration OTP.
export async function verifySignupOTP(email, token) {
  const client = requireSupabase();

  const { data, error } = await client.auth.verifyOtp({
>>>>>>> origin/main
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email"
  });

  if (error) throw error;
  return data;
}

<<<<<<< HEAD
export async function setAccountPassword(password) {
  const { data, error } = await requireSupabase().auth.updateUser({ password });

  if (error) throw error;
  return data;
}

// GOOGLE SIGNUP / LOGIN
export async function signInWithGoogle() {
  const client = requireSupabase();

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/pages/signup-details.html`
    }
=======
// STEP 3: Set password after email verification.
export async function setAccountPassword(password) {
  const client = requireSupabase();

  const { data, error } = await client.auth.updateUser({
    password
>>>>>>> origin/main
  });

  if (error) throw error;
  return data;
}

<<<<<<< HEAD
// EMAIL LOGIN
export async function loginUser(email, password) {
  const { data, error } = await requireSupabase().auth.signInWithPassword({
=======
// LOGIN: Email and password.
export async function loginUser(email, password) {
  const client = requireSupabase();

  const { data, error } = await client.auth.signInWithPassword({
>>>>>>> origin/main
    email: email.trim().toLowerCase(),
    password
  });

  if (error) throw error;
  return data;
}

<<<<<<< HEAD
// PASSWORD RECOVERY
export async function sendPasswordResetOTP(email) {
  const { error } = await requireSupabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: false }
=======
// FORGOT PASSWORD: Request recovery OTP.
export async function sendPasswordResetOTP(email) {
  const client = requireSupabase();

  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: false
    }
>>>>>>> origin/main
  });

  if (error) throw error;
  return true;
}

<<<<<<< HEAD
export async function verifyPasswordResetOTP(email, token) {
  const { data, error } = await requireSupabase().auth.verifyOtp({
=======
// Verify recovery OTP.
export async function verifyPasswordResetOTP(email, token) {
  const client = requireSupabase();

  const { data, error } = await client.auth.verifyOtp({
>>>>>>> origin/main
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email"
  });

  if (error) throw error;
  return data;
}

<<<<<<< HEAD
export async function resetPassword(newPassword) {
  const { data, error } = await requireSupabase().auth.updateUser({
=======
// Set new password after recovery verification.
export async function resetPassword(newPassword) {
  const client = requireSupabase();

  const { data, error } = await client.auth.updateUser({
>>>>>>> origin/main
    password: newPassword
  });

  if (error) throw error;
  return data;
}

<<<<<<< HEAD
// CURRENT USER
export async function getCurrentUser() {
  const { data, error } = await requireSupabase().auth.getUser();
=======
// Get current authenticated user.
export async function getCurrentUser() {
  const client = requireSupabase();

  const { data, error } = await client.auth.getUser();
>>>>>>> origin/main

  if (error) throw error;
  return data.user;
}

<<<<<<< HEAD
// GET USER PROFILE
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

// SAVE PROFILE DETAILS
export async function saveUserProfile(profile) {
  const client = requireSupabase();
  const user = await getCurrentUser();

  if (!user) throw new Error("Please sign in again.");

  const { data, error } = await client
    .from("profiles")
    .upsert({
      id: user.id,
      full_name: profile.full_name,
      nickname: profile.nickname,
      age: profile.age,
      gender: profile.gender || null,
      hall: profile.hall,
      department: profile.department,
      level: profile.level,
      onboarding_completed: false,
      updated_at: new Date().toISOString()
    }, { onConflict: "id" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// SAVE EXACTLY SEVEN INTERESTS
export async function saveUserInterests(names) {
  const client = requireSupabase();
  const user = await getCurrentUser();

  if (!user) throw new Error("Please sign in again.");

  const selected = [...new Set(names)];

  if (selected.length !== 7) {
    throw new Error("Please select exactly 7 interests.");
  }

  const { data: interests, error: lookupError } = await client
    .from("interests")
    .select("id, name")
    .in("name", selected);

  if (lookupError) throw lookupError;

  if (!interests || interests.length !== 7) {
    throw new Error("Some selected interests could not be found.");
  }

  const { error: deleteError } = await client
    .from("user_interests")
    .delete()
    .eq("user_id", user.id);

  if (deleteError) throw deleteError;

  const rows = interests.map(interest => ({
    user_id: user.id,
    interest_id: interest.id
  }));

  const { error: insertError } = await client
    .from("user_interests")
    .insert(rows);

  if (insertError) throw insertError;

  const { error: updateError } = await client
    .from("profiles")
    .update({
      onboarding_completed: true,
      updated_at: new Date().toISOString()
    })
    .eq("id", user.id);

  if (updateError) throw updateError;

  return true;
}

// LOGOUT
export async function logoutUser() {
  const { error } = await requireSupabase().auth.signOut();
=======
// LOGOUT.
export async function logoutUser() {
  const client = requireSupabase();

  const { error } = await client.auth.signOut();
>>>>>>> origin/main

  if (error) throw error;
}
