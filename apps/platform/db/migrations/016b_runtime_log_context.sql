-- LOG01: additive, compatible with existing API and historic rows. Does not enable ODM017.
ALTER TABLE ops.runtime_log
 ADD COLUMN event text NOT NULL DEFAULT 'HTTP_REQUEST',
 ADD COLUMN message text NOT NULL DEFAULT '历史请求记录',
 ADD COLUMN module text NOT NULL DEFAULT 'INFRA',
 ADD COLUMN instance text,
 ADD COLUMN trace_id text,
 ADD COLUMN span_id text,
 ADD COLUMN parent_span_id text,
 ADD COLUMN actor_id text,
 ADD COLUMN actor_kind text,
 ADD COLUMN context jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN error jsonb;
CREATE INDEX runtime_trace ON ops.runtime_log(factory_id,trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX runtime_event_time ON ops.runtime_log(factory_id,event,occurred_at DESC);
