CREATE TABLE owners(id uuid PRIMARY KEY,email text NOT NULL UNIQUE,password_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sessions(token_hash text PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL);
CREATE INDEX sessions_owner ON sessions(owner_id,expires_at);
CREATE TABLE images(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owners(id),content_hash text NOT NULL,filename text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','flagged','failed')),metadata jsonb,flag_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,content_hash),UNIQUE(id,owner_id));
CREATE INDEX images_owner_status ON images(owner_id,status);
CREATE TABLE tags(image_id uuid NOT NULL,owner_id uuid NOT NULL,tag text NOT NULL,PRIMARY KEY(image_id,tag),FOREIGN KEY(image_id,owner_id) REFERENCES images(id,owner_id) ON DELETE CASCADE);
CREATE INDEX tags_owner ON tags(owner_id,tag);
CREATE TABLE posts(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owners(id),title text NOT NULL,content text NOT NULL,request_key text NOT NULL,payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,owner_id),UNIQUE(owner_id,request_key));
CREATE INDEX posts_owner ON posts(owner_id,created_at);
CREATE TABLE vectors(owner_id uuid NOT NULL REFERENCES owners(id),target_type text NOT NULL CHECK(target_type IN ('image','post')),target_id uuid NOT NULL,
  model text NOT NULL,dimensions integer NOT NULL,embedding double precision[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,target_type,target_id,model),CHECK(array_length(embedding,1)=dimensions));
CREATE TABLE jobs(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owners(id),target_type text NOT NULL CHECK(target_type IN ('image','post')),target_id uuid NOT NULL,
  version text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),attempts integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,lease_token uuid,last_error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,target_type,target_id,version));
CREATE INDEX jobs_due ON jobs(status,next_at,lease_until);
CREATE INDEX jobs_owner ON jobs(owner_id,created_at);
CREATE TABLE daily_budgets(owner_id uuid NOT NULL REFERENCES owners(id),day date NOT NULL,calls integer NOT NULL DEFAULT 0,reserved_usd numeric(12,6) NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,day));
CREATE TABLE ai_calls(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owners(id),job_id uuid REFERENCES jobs(id),target_id uuid NOT NULL,kind text NOT NULL,model text NOT NULL,
  status text NOT NULL DEFAULT 'started',input_tokens integer,output_tokens integer,duration_ms integer,cost_usd numeric(12,6) NOT NULL DEFAULT 0,error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
CREATE INDEX ai_calls_owner_time ON ai_calls(owner_id,created_at);
CREATE TABLE match_runs(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owners(id),post_id uuid NOT NULL,
  config jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,owner_id),FOREIGN KEY(post_id,owner_id) REFERENCES posts(id,owner_id));
CREATE TABLE suggestions(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES owners(id),run_id uuid NOT NULL,post_id uuid NOT NULL,image_id uuid NOT NULL,
  rank integer NOT NULL,similarity double precision NOT NULL,confidence double precision NOT NULL,accepted boolean NOT NULL,reasons jsonb NOT NULL,
  UNIQUE(id,owner_id),UNIQUE(run_id,image_id),FOREIGN KEY(run_id,owner_id) REFERENCES match_runs(id,owner_id),FOREIGN KEY(post_id,owner_id) REFERENCES posts(id,owner_id),FOREIGN KEY(image_id,owner_id) REFERENCES images(id,owner_id));
CREATE INDEX suggestions_rank ON suggestions(owner_id,run_id,rank);
CREATE TABLE reviews(suggestion_id uuid PRIMARY KEY,owner_id uuid NOT NULL,decision text NOT NULL CHECK(decision IN ('approve','reject')),note text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(suggestion_id,owner_id) REFERENCES suggestions(id,owner_id));
