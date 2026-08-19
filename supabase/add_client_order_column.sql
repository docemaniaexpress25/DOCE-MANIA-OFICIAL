-- Execute this in Supabase SQL Editor
ALTER TABLE public.app_settings 
ADD COLUMN IF NOT EXISTS client_order JSONB DEFAULT '[]'::jsonb;

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'app_settings' AND column_name = 'client_order';