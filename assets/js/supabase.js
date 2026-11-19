
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Add your real credentials later.
const SUPABASE_URL = "https://hvyfzgguudvqwtybsvfv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Cf8_C-8K0JhD7hwJd_lFVQ_XNvPNmOa";

export const supabaseConfigured =
  SUPABASE_URL !== "YOUR_SUPABASE_PROJECT_URL" &&
  SUPABASE_PUBLISHABLE_KEY !== "YOUR_SUPABASE_PUBLISHABLE_KEY";

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
