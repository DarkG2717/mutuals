
import { supabase, supabaseConfigured } from "./supabase.js";

function requireSupabase() {
  if (!supabaseConfigured || !supabase) {
    throw new Error("Supabase credentials have not been configured yet.");
  }
  return supabase;
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
