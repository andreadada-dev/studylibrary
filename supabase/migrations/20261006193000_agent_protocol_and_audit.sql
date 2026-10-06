-- StudyLibrary Agent Protocol + catalog quality audit
-- Public endpoints remain read-only and only inspect API-public content.

create or replace function public.studylibrary_catalog_stats(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  library jsonb;
  lesson jsonb;
  libraries_count integer := 0;
  lessons_count integer := 0;
  topics_count integer := 0;
  minutes_count integer := 0;
begin
  for library in
    select value from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    libraries_count := libraries_count + 1;

    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      lessons_count := lessons_count + 1;
      topics_count := topics_count + jsonb_array_length(coalesce(lesson->'topics', '[]'::jsonb));

      if coalesce(lesson->>'estimatedMinutes', '') ~ '^[0-9]+$' then
        minutes_count := minutes_count + (lesson->>'estimatedMinutes')::integer;
      else
        minutes_count := minutes_count + coalesce((
          select sum(
            case
              when coalesce(topic->>'estimatedMinutes', '') ~ '^[0-9]+$'
                then (topic->>'estimatedMinutes')::integer
              else 0
            end
          )
          from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb)) topic
        ), 0);
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'libraries', libraries_count,
    'lessons', lessons_count,
    'topics', topics_count,
    'estimatedMinutes', minutes_count
  );
end;
$$;

create or replace function public.studylibrary_catalog_audit_json(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  library jsonb;
  lesson jsonb;
  topic jsonb;
  section jsonb;
  source jsonb;
  prerequisite text;
  connection jsonb;
  module jsonb;
  module_topic_id text;

  library_key text;
  lesson_key text;
  topic_key text;
  topic_path text;

  topic_ids text[];
  source_ids text[];
  module_topic_ids text[];

  issues jsonb := '[]'::jsonb;
  errors_count integer := 0;
  warnings_count integer := 0;
  suggestions_count integer := 0;
  total_topics integer := 0;
  complete_topics integer := 0;
  topic_has_problem boolean;
  has_checkpoint boolean;
  has_example boolean;
begin
  for library in
    select value from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    library_key := coalesce(library->>'slug', library->>'id', 'library');

    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      lesson_key := coalesce(lesson->>'slug', lesson->>'id', 'lesson');

      select coalesce(array_agg(value->>'id') filter (where value ? 'id'), '{}'::text[])
      into topic_ids
      from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb));

      select coalesce(array_agg(value->>'id') filter (where value ? 'id'), '{}'::text[])
      into source_ids
      from jsonb_array_elements(coalesce(lesson->'sources', '[]'::jsonb));

      select coalesce(array_agg(topic_id_value), '{}'::text[])
      into module_topic_ids
      from jsonb_array_elements(coalesce(lesson->'modules', '[]'::jsonb)) module_value
      cross join lateral jsonb_array_elements_text(coalesce(module_value->'topicIds', '[]'::jsonb)) topic_id(topic_id_value);

      -- Module references should always resolve to a topic in the lesson.
      for module in
        select value from jsonb_array_elements(coalesce(lesson->'modules', '[]'::jsonb))
      loop
        for module_topic_id in
          select value from jsonb_array_elements_text(coalesce(module->'topicIds', '[]'::jsonb))
        loop
          if not (module_topic_id = any(topic_ids)) then
            errors_count := errors_count + 1;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error',
              'type', 'broken-module-topic',
              'path', library_key || '/' || lesson_key,
              'message', 'Il modulo ' || coalesce(module->>'id', 'senza-id') || ' riferisce il topic inesistente ' || module_topic_id || '.'
            ));
          end if;
        end loop;
      end loop;

      for topic in
        select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
      loop
        total_topics := total_topics + 1;
        topic_has_problem := false;
        topic_key := coalesce(topic->>'id', 'topic-' || total_topics);
        topic_path := library_key || '/' || lesson_key || '/' || topic_key;

        if btrim(coalesce(topic->>'summary', '')) = '' then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-summary', 'path', topic_path,
            'message', 'Manca il riassunto del topic.'
          ));
        end if;

        if btrim(coalesce(topic->>'why', '')) = '' then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-why', 'path', topic_path,
            'message', 'Manca la spiegazione del perché questo argomento serve.'
          ));
        end if;

        if jsonb_array_length(coalesce(topic->'learningGoals', '[]'::jsonb)) = 0 then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-learning-goals', 'path', topic_path,
            'message', 'Aggiungi almeno un obiettivo di apprendimento verificabile.'
          ));
        end if;

        select exists(
          select 1
          from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) section_value
          where section_value->>'type' = 'checkpoint'
        ) into has_checkpoint;

        if not has_checkpoint then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-checkpoint', 'path', topic_path,
            'message', 'Il topic non contiene un checkpoint.'
          ));
        end if;

        if jsonb_array_length(coalesce(topic->'sources', '[]'::jsonb)) = 0 then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-sources', 'path', topic_path,
            'message', 'Il topic non contiene fonti.'
          ));
        end if;

        if not (topic_key = any(module_topic_ids)) then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'orphan-topic', 'path', topic_path,
            'message', 'Il topic non appartiene a nessun modulo della lezione.'
          ));
        end if;

        if jsonb_array_length(coalesce(topic->'connections', '[]'::jsonb)) = 0 then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'missing-connections', 'path', topic_path,
            'message', 'Il topic non ha collegamenti espliciti con altri concetti.'
          ));
        end if;

        if not (coalesce(topic->>'estimatedMinutes', '') ~ '^[0-9]+

        select exists(
          select 1
          from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) section_value
          where section_value->>'type' in ('example', 'image', 'formula', 'flow', 'comparison', 'list')
        ) into has_example;

        if not has_example then
          suggestions_count := suggestions_count + 1;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'suggestion', 'type', 'add-example-or-visual', 'path', topic_path,
            'message', 'Valuta un esempio, visuale, formula, confronto o flow se migliora la comprensione.'
          ));
        end if;

        for source in
          select value from jsonb_array_elements(coalesce(topic->'sources', '[]'::jsonb))
        loop
          if btrim(coalesce(source->>'ref', '')) = '' then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'missing-source-ref', 'path', topic_path,
              'message', 'Una fonte del topic non ha il campo ref.'
            ));
          elsif cardinality(source_ids) > 0 and not ((source->>'ref') = any(source_ids)) then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'unknown-source-ref', 'path', topic_path,
              'message', 'La fonte ' || (source->>'ref') || ' non esiste tra le sources della lezione.'
            ));
          end if;

          if btrim(coalesce(source->>'pages', '')) = '' then
            warnings_count := warnings_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'warning', 'type', 'weak-source-location', 'path', topic_path,
              'message', 'Una fonte non specifica slide/pagine.'
            ));
          end if;
        end loop;

        for prerequisite in
          select value from jsonb_array_elements_text(coalesce(topic->'prerequisites', '[]'::jsonb))
        loop
          if position('/' in prerequisite) = 0 and not (prerequisite = any(topic_ids)) then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'broken-prerequisite', 'path', topic_path,
              'message', 'Prerequisito locale inesistente: ' || prerequisite || '.'
            ));
          end if;
        end loop;

        for connection in
          select value from jsonb_array_elements(coalesce(topic->'connections', '[]'::jsonb))
        loop
          if btrim(coalesce(connection->>'target', '')) = '' then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'missing-connection-target', 'path', topic_path,
              'message', 'Una connessione non ha target.'
            ));
          elsif position('/' in (connection->>'target')) = 0
            and not ((connection->>'target') = any(topic_ids)) then
            warnings_count := warnings_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'warning', 'type', 'unresolved-local-connection', 'path', topic_path,
              'message', 'Target locale della connessione non trovato: ' || (connection->>'target') || '.'
            ));
          end if;
        end loop;

        if not topic_has_problem then
          complete_topics := complete_topics + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'errors', errors_count,
      'warnings', warnings_count,
      'suggestions', suggestions_count,
      'completeTopics', complete_topics,
      'totalTopics', total_topics
    ),
    'issues', issues
  );
end;
$$;

create or replace function public.studylibrary_resolve_api_catalog(p_catalog_key text)
returns public.catalogs
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  matches integer;
  row_catalog public.catalogs%rowtype;
begin
  if p_catalog_key is null or btrim(p_catalog_key) = '' then
    return null;
  end if;

  -- UUID is canonical and unambiguous.
  begin
    select c.* into row_catalog
    from public.catalogs c
    where c.api_public = true
      and c.id = p_catalog_key::uuid
    limit 1;

    if found then
      return row_catalog;
    end if;
  exception when invalid_text_representation then
    null;
  end;

  select count(*)
  into matches
  from public.catalogs c
  where c.api_public = true
    and c.slug = p_catalog_key;

  if matches <> 1 then
    return null;
  end if;

  select c.* into row_catalog
  from public.catalogs c
  where c.api_public = true
    and c.slug = p_catalog_key
  limit 1;

  return row_catalog;
end;
$$;

create or replace function public.studylibrary_catalog_audit(catalog_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
begin
  row_catalog := public.studylibrary_resolve_api_catalog(catalog_key);

  if row_catalog.id is null then
    return jsonb_build_object(
      'error', 'catalog_not_found_or_ambiguous',
      'hint', 'Use the API-public catalog UUID for a stable lookup.'
    );
  end if;

  filtered := public.api_filter_catalog(row_catalog.catalog_json);

  return jsonb_build_object(
    'catalogId', row_catalog.id,
    'slug', row_catalog.slug,
    'title', row_catalog.title,
    'version', row_catalog.current_version,
    'auditedAt', now(),
    'data', public.studylibrary_catalog_audit_json(filtered)
  );
end;
$$;

create or replace function public.studylibrary_catalog_agent(catalog_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
  audit jsonb;
  stable_key text;
begin
  row_catalog := public.studylibrary_resolve_api_catalog(catalog_key);

  if row_catalog.id is null then
    return jsonb_build_object(
      'error', 'catalog_not_found_or_ambiguous',
      'hint', 'Use the API-public catalog UUID. Slugs are accepted only when unique.'
    );
  end if;

  filtered := public.api_filter_catalog(row_catalog.catalog_json);
  audit := public.studylibrary_catalog_audit_json(filtered);
  stable_key := row_catalog.id::text;

  return jsonb_build_object(
    'protocol', 'studylibrary',
    'protocolVersion', '1.0',
    'instructions', '/api/v1/agent',
    'schemas', jsonb_build_object(
      'catalog', '/api/v1/schema/catalog',
      'lesson', '/api/v1/schema/lesson',
      'topic', '/api/v1/schema/topic',
      'updatePackage', '/api/v1/schema/update-package'
    ),
    'catalog', jsonb_build_object(
      'id', row_catalog.id,
      'slug', row_catalog.slug,
      'title', row_catalog.title,
      'currentVersion', row_catalog.current_version,
      'updatedAt', row_catalog.updated_at,
      'apiPublic', row_catalog.api_public,
      'homePublic', row_catalog.is_public
    ),
    'stats', public.studylibrary_catalog_stats(filtered),
    'auditSummary', audit->'summary',
    'endpoints', jsonb_build_object(
      'self', '/api/v1/catalogs/' || stable_key || '/agent',
      'catalog', '/api/v1/catalogs/' || stable_key,
      'context', '/api/v1/catalogs/' || stable_key || '/context',
      'audit', '/api/v1/catalogs/' || stable_key || '/audit',
      'graph', '/api/v1/catalogs/' || stable_key || '/graph',
      'versions', '/api/v1/catalogs/' || stable_key || '/versions',
      'changes', '/api/v1/catalogs/' || stable_key || '/changes/{version}',
      'libraries', '/api/v1/catalogs/' || stable_key || '/libraries',
      'write', '/api/v1/write'
    ),
    'recommendedReadOrder', jsonb_build_array(
      '/api/v1/agent',
      '/api/v1/catalogs/' || stable_key || '/agent',
      '/api/v1/catalogs/' || stable_key || '/context',
      '/api/v1/catalogs/' || stable_key || '/audit',
      '/api/v1/catalogs/' || stable_key || '/graph'
    ),
    'update', jsonb_build_object(
      'preferredFormat', 'studylibrary.update',
      'baseVersion', row_catalog.current_version,
      'schema', '/api/v1/schema/update-package',
      'rule', 'Do not generate an update against a different baseVersion.'
    )
  );
end;
$$;

revoke all on function public.studylibrary_catalog_stats(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_catalog_audit_json(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_resolve_api_catalog(text) from public, anon, authenticated;

revoke all on function public.studylibrary_catalog_audit(text) from public;
grant execute on function public.studylibrary_catalog_audit(text) to anon, authenticated;

revoke all on function public.studylibrary_catalog_agent(text) from public;
grant execute on function public.studylibrary_catalog_agent(text) to anon, authenticated;
) then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'missing-estimated-time', 'path', topic_path,
            'message', 'Manca una stima di tempo utile per il topic.'
          ));
        elsif (topic->>'estimatedMinutes')::integer <= 0 then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'missing-estimated-time', 'path', topic_path,
            'message', 'Manca una stima di tempo utile per il topic.'
          ));
        end if;

        select exists(
          select 1
          from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) section_value
          where section_value->>'type' in ('example', 'image', 'formula', 'flow', 'comparison', 'list')
        ) into has_example;

        if not has_example then
          suggestions_count := suggestions_count + 1;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'suggestion', 'type', 'add-example-or-visual', 'path', topic_path,
            'message', 'Valuta un esempio, visuale, formula, confronto o flow se migliora la comprensione.'
          ));
        end if;

        for source in
          select value from jsonb_array_elements(coalesce(topic->'sources', '[]'::jsonb))
        loop
          if btrim(coalesce(source->>'ref', '')) = '' then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'missing-source-ref', 'path', topic_path,
              'message', 'Una fonte del topic non ha il campo ref.'
            ));
          elsif cardinality(source_ids) > 0 and not ((source->>'ref') = any(source_ids)) then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'unknown-source-ref', 'path', topic_path,
              'message', 'La fonte ' || (source->>'ref') || ' non esiste tra le sources della lezione.'
            ));
          end if;

          if btrim(coalesce(source->>'pages', '')) = '' then
            warnings_count := warnings_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'warning', 'type', 'weak-source-location', 'path', topic_path,
              'message', 'Una fonte non specifica slide/pagine.'
            ));
          end if;
        end loop;

        for prerequisite in
          select value from jsonb_array_elements_text(coalesce(topic->'prerequisites', '[]'::jsonb))
        loop
          if position('/' in prerequisite) = 0 and not (prerequisite = any(topic_ids)) then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'broken-prerequisite', 'path', topic_path,
              'message', 'Prerequisito locale inesistente: ' || prerequisite || '.'
            ));
          end if;
        end loop;

        for connection in
          select value from jsonb_array_elements(coalesce(topic->'connections', '[]'::jsonb))
        loop
          if btrim(coalesce(connection->>'target', '')) = '' then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'missing-connection-target', 'path', topic_path,
              'message', 'Una connessione non ha target.'
            ));
          elsif position('/' in (connection->>'target')) = 0
            and not ((connection->>'target') = any(topic_ids)) then
            warnings_count := warnings_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'warning', 'type', 'unresolved-local-connection', 'path', topic_path,
              'message', 'Target locale della connessione non trovato: ' || (connection->>'target') || '.'
            ));
          end if;
        end loop;

        if not topic_has_problem then
          complete_topics := complete_topics + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'errors', errors_count,
      'warnings', warnings_count,
      'suggestions', suggestions_count,
      'completeTopics', complete_topics,
      'totalTopics', total_topics
    ),
    'issues', issues
  );
end;
$$;

create or replace function public.studylibrary_resolve_api_catalog(p_catalog_key text)
returns public.catalogs
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  matches integer;
  row_catalog public.catalogs%rowtype;
begin
  if p_catalog_key is null or btrim(p_catalog_key) = '' then
    return null;
  end if;

  -- UUID is canonical and unambiguous.
  begin
    select c.* into row_catalog
    from public.catalogs c
    where c.api_public = true
      and c.id = p_catalog_key::uuid
    limit 1;

    if found then
      return row_catalog;
    end if;
  exception when invalid_text_representation then
    null;
  end;

  select count(*)
  into matches
  from public.catalogs c
  where c.api_public = true
    and c.slug = p_catalog_key;

  if matches <> 1 then
    return null;
  end if;

  select c.* into row_catalog
  from public.catalogs c
  where c.api_public = true
    and c.slug = p_catalog_key
  limit 1;

  return row_catalog;
end;
$$;

create or replace function public.studylibrary_catalog_audit(catalog_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
begin
  row_catalog := public.studylibrary_resolve_api_catalog(catalog_key);

  if row_catalog.id is null then
    return jsonb_build_object(
      'error', 'catalog_not_found_or_ambiguous',
      'hint', 'Use the API-public catalog UUID for a stable lookup.'
    );
  end if;

  filtered := public.api_filter_catalog(row_catalog.catalog_json);

  return jsonb_build_object(
    'catalogId', row_catalog.id,
    'slug', row_catalog.slug,
    'title', row_catalog.title,
    'version', row_catalog.current_version,
    'auditedAt', now(),
    'data', public.studylibrary_catalog_audit_json(filtered)
  );
end;
$$;

create or replace function public.studylibrary_catalog_agent(catalog_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
  audit jsonb;
  stable_key text;
begin
  row_catalog := public.studylibrary_resolve_api_catalog(catalog_key);

  if row_catalog.id is null then
    return jsonb_build_object(
      'error', 'catalog_not_found_or_ambiguous',
      'hint', 'Use the API-public catalog UUID. Slugs are accepted only when unique.'
    );
  end if;

  filtered := public.api_filter_catalog(row_catalog.catalog_json);
  audit := public.studylibrary_catalog_audit_json(filtered);
  stable_key := row_catalog.id::text;

  return jsonb_build_object(
    'protocol', 'studylibrary',
    'protocolVersion', '1.0',
    'instructions', '/api/v1/agent',
    'schemas', jsonb_build_object(
      'catalog', '/api/v1/schema/catalog',
      'lesson', '/api/v1/schema/lesson',
      'topic', '/api/v1/schema/topic',
      'updatePackage', '/api/v1/schema/update-package'
    ),
    'catalog', jsonb_build_object(
      'id', row_catalog.id,
      'slug', row_catalog.slug,
      'title', row_catalog.title,
      'currentVersion', row_catalog.current_version,
      'updatedAt', row_catalog.updated_at,
      'apiPublic', row_catalog.api_public,
      'homePublic', row_catalog.is_public
    ),
    'stats', public.studylibrary_catalog_stats(filtered),
    'auditSummary', audit->'summary',
    'endpoints', jsonb_build_object(
      'self', '/api/v1/catalogs/' || stable_key || '/agent',
      'catalog', '/api/v1/catalogs/' || stable_key,
      'context', '/api/v1/catalogs/' || stable_key || '/context',
      'audit', '/api/v1/catalogs/' || stable_key || '/audit',
      'graph', '/api/v1/catalogs/' || stable_key || '/graph',
      'versions', '/api/v1/catalogs/' || stable_key || '/versions',
      'changes', '/api/v1/catalogs/' || stable_key || '/changes/{version}',
      'libraries', '/api/v1/catalogs/' || stable_key || '/libraries',
      'write', '/api/v1/write'
    ),
    'recommendedReadOrder', jsonb_build_array(
      '/api/v1/agent',
      '/api/v1/catalogs/' || stable_key || '/agent',
      '/api/v1/catalogs/' || stable_key || '/context',
      '/api/v1/catalogs/' || stable_key || '/audit',
      '/api/v1/catalogs/' || stable_key || '/graph'
    ),
    'update', jsonb_build_object(
      'preferredFormat', 'studylibrary.update',
      'baseVersion', row_catalog.current_version,
      'schema', '/api/v1/schema/update-package',
      'rule', 'Do not generate an update against a different baseVersion.'
    )
  );
end;
$$;

revoke all on function public.studylibrary_catalog_stats(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_catalog_audit_json(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_resolve_api_catalog(text) from public, anon, authenticated;

revoke all on function public.studylibrary_catalog_audit(text) from public;
grant execute on function public.studylibrary_catalog_audit(text) to anon, authenticated;

revoke all on function public.studylibrary_catalog_agent(text) from public;
grant execute on function public.studylibrary_catalog_agent(text) to anon, authenticated;


-- Validate direct API writes server-side too; browser validation is not a security boundary.
create or replace function public.studylibrary_catalog_json_errors(p_catalog jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  errors text[] := '{}';
  library jsonb;
  lesson jsonb;
  topic jsonb;
begin
  if p_catalog is null or jsonb_typeof(p_catalog) <> 'object' then
    return array['Catalog must be a JSON object'];
  end if;

  if btrim(coalesce(p_catalog->>'slug', '')) = '' then
    errors := array_append(errors, 'Catalog slug is required');
  end if;
  if btrim(coalesce(p_catalog->>'title', '')) = '' then
    errors := array_append(errors, 'Catalog title is required');
  end if;
  if char_length(coalesce(p_catalog->>'title', '')) > 160 then
    errors := array_append(errors, 'Catalog title exceeds 160 characters');
  end if;
  if char_length(coalesce(p_catalog->>'description', '')) > 4000 then
    errors := array_append(errors, 'Catalog description exceeds 4000 characters');
  end if;
  if octet_length(p_catalog::text) > 5242880 then
    errors := array_append(errors, 'Catalog JSON exceeds 5 MB');
  end if;
  if jsonb_typeof(p_catalog->'libraries') <> 'array'
     or jsonb_array_length(coalesce(p_catalog->'libraries', '[]'::jsonb)) = 0 then
    errors := array_append(errors, 'Catalog must contain at least one library');
    return errors;
  end if;

  for library in
    select value from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    if btrim(coalesce(library->>'slug', '')) = '' then
      errors := array_append(errors, 'Library slug is required');
    end if;
    if btrim(coalesce(library->>'title', '')) = '' then
      errors := array_append(errors, 'Library title is required');
    end if;
    if jsonb_typeof(library->'lessons') <> 'array'
       or jsonb_array_length(coalesce(library->'lessons', '[]'::jsonb)) = 0 then
      errors := array_append(errors, 'Library ' || coalesce(library->>'slug', '?') || ' must contain at least one lesson');
      continue;
    end if;

    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      if btrim(coalesce(lesson->>'slug', '')) = '' then
        errors := array_append(errors, 'Lesson slug is required');
      end if;
      if btrim(coalesce(lesson->>'title', '')) = '' then
        errors := array_append(errors, 'Lesson title is required');
      end if;
      if jsonb_typeof(lesson->'modules') <> 'array'
         or jsonb_array_length(coalesce(lesson->'modules', '[]'::jsonb)) = 0 then
        errors := array_append(errors, 'Lesson ' || coalesce(lesson->>'slug', '?') || ' must contain modules');
      end if;
      if jsonb_typeof(lesson->'topics') <> 'array'
         or jsonb_array_length(coalesce(lesson->'topics', '[]'::jsonb)) = 0 then
        errors := array_append(errors, 'Lesson ' || coalesce(lesson->>'slug', '?') || ' must contain topics');
        continue;
      end if;

      for topic in
        select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
      loop
        if btrim(coalesce(topic->>'id', '')) = '' then
          errors := array_append(errors, 'Topic id is required');
        end if;
        if btrim(coalesce(topic->>'title', '')) = '' then
          errors := array_append(errors, 'Topic title is required');
        end if;
        if btrim(coalesce(topic->>'summary', '')) = '' then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' summary is required');
        end if;
        if btrim(coalesce(topic->>'why', '')) = '' then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' why is required');
        end if;
        if jsonb_typeof(topic->'sources') <> 'array'
           or jsonb_array_length(coalesce(topic->'sources', '[]'::jsonb)) = 0 then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' must contain at least one source');
        end if;
        if jsonb_typeof(topic->'sections') <> 'array'
           or not exists (
             select 1
             from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) section_value
             where section_value->>'type' = 'checkpoint'
           ) then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' must contain a checkpoint');
        end if;
      end loop;
    end loop;
  end loop;

  return errors;
end;
$$;

create or replace function public.studylibrary_api_write(
  p_catalog_id uuid,
  p_base_version integer,
  p_message text,
  p_catalog jsonb,
  p_publish boolean default null,
  p_api_public boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.catalogs%rowtype;
  next_api_public boolean;
  next_publish boolean;
  validation_errors text[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select c.* into current_row
  from public.catalogs c
  where c.id = p_catalog_id
    and c.owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'catalog_not_found';
  end if;

  if p_base_version is not null and p_base_version <> current_row.current_version then
    raise exception 'version_conflict: current version is %', current_row.current_version;
  end if;

  validation_errors := public.studylibrary_catalog_json_errors(p_catalog);
  if cardinality(validation_errors) > 0 then
    raise exception 'invalid_catalog: %', array_to_string(validation_errors[1:least(cardinality(validation_errors), 12)], '; ');
  end if;

  if p_catalog->>'slug' is distinct from current_row.slug then
    raise exception 'slug_mismatch: expected %', current_row.slug;
  end if;

  next_publish := coalesce(p_publish, current_row.is_public);
  next_api_public := coalesce(
    p_api_public,
    case
      when jsonb_typeof(p_catalog #> '{api,publicRead}') = 'boolean'
        then (p_catalog #>> '{api,publicRead}')::boolean
      else current_row.api_public
    end
  );

  p_catalog := p_catalog || jsonb_build_object(
    'visibility', case when next_publish then 'public' else 'private' end,
    'api', coalesce(p_catalog->'api', '{}'::jsonb) || jsonb_build_object('publicRead', next_api_public)
  );

  update public.catalogs
  set
    title = p_catalog->>'title',
    description = coalesce(p_catalog->>'description', ''),
    tags = coalesce(
      array(select jsonb_array_elements_text(coalesce(p_catalog->'tags', '[]'::jsonb))),
      '{}'::text[]
    ),
    is_public = next_publish,
    api_public = next_api_public,
    catalog_json = p_catalog,
    version_message = left(coalesce(nullif(trim(p_message), ''), 'Aggiornamento API'), 240)
  where id = p_catalog_id;

  select c.* into current_row from public.catalogs c where c.id = p_catalog_id;

  return jsonb_build_object(
    'catalogId', current_row.id,
    'version', current_row.current_version,
    'updatedAt', current_row.updated_at,
    'apiPublic', current_row.api_public,
    'published', current_row.is_public
  );
end;
$$;

revoke all on function public.studylibrary_catalog_json_errors(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) from public;
revoke all on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) from anon;
grant execute on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) to authenticated;
