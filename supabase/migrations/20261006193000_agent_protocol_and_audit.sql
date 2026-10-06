-- StudyLibrary Agent Protocol, media-aware API filtering and catalog quality audit.
-- This migration supersedes the failed draft with a clean, idempotent definition.

-- Keep catalog-level media private when every reference lives inside hidden content.
create or replace function public.api_filter_catalog(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  library jsonb;
  filtered_library jsonb;
  lesson jsonb;
  topic jsonb;
  section jsonb;
  gallery_item jsonb;
  media_asset jsonb;
  libraries jsonb := '[]'::jsonb;
  filtered_media jsonb := '[]'::jsonb;
  visible_media_refs text[] := '{}';
begin
  for library in
    select value
    from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    filtered_library := public.api_filter_library(library, true);
    if filtered_library is not null then
      libraries := libraries || jsonb_build_array(filtered_library);

      for lesson in
        select value
        from jsonb_array_elements(coalesce(filtered_library->'lessons', '[]'::jsonb))
      loop
        for topic in
          select value
          from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
        loop
          for section in
            select value
            from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb))
          loop
            if btrim(coalesce(section->>'mediaRef', '')) <> '' then
              visible_media_refs := array_append(visible_media_refs, section->>'mediaRef');
            end if;

            if section->>'type' = 'gallery' then
              for gallery_item in
                select value
                from jsonb_array_elements(coalesce(section->'items', '[]'::jsonb))
              loop
                if jsonb_typeof(gallery_item) = 'string' then
                  visible_media_refs := array_append(visible_media_refs, gallery_item #>> '{}');
                elsif btrim(coalesce(gallery_item->>'mediaRef', '')) <> '' then
                  visible_media_refs := array_append(visible_media_refs, gallery_item->>'mediaRef');
                end if;
              end loop;
            end if;
          end loop;
        end loop;
      end loop;
    end if;
  end loop;

  for media_asset in
    select value
    from jsonb_array_elements(coalesce(p_catalog->'media', '[]'::jsonb))
  loop
    if media_asset->>'id' = any(visible_media_refs) then
      filtered_media := filtered_media || jsonb_build_array(media_asset);
    end if;
  end loop;

  return jsonb_set(
    jsonb_set(p_catalog, '{libraries}', libraries, true),
    '{media}', filtered_media, true
  );
end;
$$;

create or replace function public.studylibrary_catalog_stats(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  library jsonb;
  lesson jsonb;
  topic jsonb;
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

      for topic in
        select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
      loop
        topics_count := topics_count + 1;
        if jsonb_typeof(topic->'estimatedMinutes') = 'number' then
          minutes_count := minutes_count + greatest(0, (topic->>'estimatedMinutes')::integer);
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'libraries', libraries_count,
    'lessons', lessons_count,
    'topics', topics_count,
    'estimatedMinutes', minutes_count,
    'media', jsonb_array_length(coalesce(p_catalog->'media', '[]'::jsonb))
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
  connection jsonb;
  module jsonb;
  media_asset jsonb;
  gallery_item jsonb;
  prerequisite text;
  module_topic_id text;

  library_key text;
  lesson_key text;
  topic_key text;
  topic_path text;

  topic_ids text[];
  source_ids text[];
  module_topic_ids text[];
  media_ids text[] := '{}';

  issues jsonb := '[]'::jsonb;
  errors_count integer := 0;
  warnings_count integer := 0;
  suggestions_count integer := 0;
  total_topics integer := 0;
  complete_topics integer := 0;
  total_media integer := 0;
  topic_has_problem boolean;
  has_checkpoint boolean;
  has_rich_explanation boolean;
begin
  for media_asset in
    select value from jsonb_array_elements(coalesce(p_catalog->'media', '[]'::jsonb))
  loop
    total_media := total_media + 1;

    if btrim(coalesce(media_asset->>'id', '')) = '' then
      errors_count := errors_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'type', 'missing-media-id',
        'path', 'media',
        'message', 'Un media non ha un id.'
      ));
    else
      media_ids := array_append(media_ids, media_asset->>'id');
    end if;

    if coalesce(media_asset->>'type', '') not in ('image', 'video') then
      errors_count := errors_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'type', 'invalid-media-type',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'Il media deve essere image o video.'
      ));
    end if;

    if btrim(coalesce(media_asset->>'url', '')) = '' then
      errors_count := errors_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'type', 'missing-media-url',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'Il media non ha un URL.'
      ));
    end if;

    if media_asset->>'type' = 'image'
       and btrim(coalesce(media_asset->>'alt', '')) = '' then
      warnings_count := warnings_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'warning',
        'type', 'missing-image-alt',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'L’immagine non ha alt text.'
      ));
    end if;

    if btrim(coalesce(media_asset->>'sourceUrl', '')) = '' then
      suggestions_count := suggestions_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'suggestion',
        'type', 'missing-media-source',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'Aggiungi la pagina originale della fonte quando disponibile.'
      ));
    end if;

    if btrim(coalesce(media_asset->>'license', '')) = '' then
      suggestions_count := suggestions_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'suggestion',
        'type', 'missing-media-license',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'La licenza del media non è indicata.'
      ));
    end if;
  end loop;

  for library in
    select value from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    library_key := coalesce(library->>'slug', library->>'id', 'library');

    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      lesson_key := coalesce(lesson->>'slug', lesson->>'id', 'lesson');

      select coalesce(array_agg(t.value), '{}'::text[])
      into topic_ids
      from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb)) as t(value)
      where btrim(coalesce(t.value->>'id', '')) <> '';

      select coalesce(array_agg(s.value), '{}'::text[])
      into source_ids
      from jsonb_array_elements(coalesce(lesson->'sources', '[]'::jsonb)) as s(value)
      where btrim(coalesce(s.value->>'id', '')) <> '';

      select coalesce(array_agg(topic_ref.value), '{}'::text[])
      into module_topic_ids
      from jsonb_array_elements(coalesce(lesson->'modules', '[]'::jsonb)) as m(value)
      cross join lateral jsonb_array_elements_text(coalesce(m.value->'topicIds', '[]'::jsonb)) as topic_ref(value);

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
              'message', 'Il modulo ' || coalesce(module->>'id', '?') || ' riferisce il topic inesistente ' || module_topic_id || '.'
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
            'message', 'Aggiungi almeno un obiettivo di apprendimento.'
          ));
        end if;

        select exists(
          select 1
          from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) as sec(value)
          where sec.value->>'type' = 'checkpoint'
        )
        into has_checkpoint;

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
            'message', 'Il topic non appartiene a nessun modulo.'
          ));
        end if;

        if jsonb_array_length(coalesce(topic->'connections', '[]'::jsonb)) = 0 then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'missing-connections', 'path', topic_path,
            'message', 'Il topic non ha collegamenti espliciti.'
          ));
        end if;

        if jsonb_typeof(topic->'estimatedMinutes') <> 'number'
           or (topic->>'estimatedMinutes')::numeric <= 0 then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'missing-estimated-time', 'path', topic_path,
            'message', 'Manca una stima di tempo utile per il topic.'
          ));
        end if;

        select exists(
          select 1
          from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) as sec(value)
          where sec.value->>'type' in ('example', 'image', 'video', 'gallery', 'formula', 'flow', 'comparison', 'list')
        )
        into has_rich_explanation;

        if not has_rich_explanation then
          suggestions_count := suggestions_count + 1;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'suggestion', 'type', 'add-example-or-media', 'path', topic_path,
            'message', 'Valuta un esempio, immagine, video, formula, confronto o flow se migliora la comprensione.'
          ));
        end if;

        for section in
          select value from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb))
        loop
          if section->>'type' in ('image', 'video') then
            if btrim(coalesce(section->>'mediaRef', '')) = ''
               and btrim(coalesce(section->>'url', section->>'src', '')) = '' then
              errors_count := errors_count + 1;
              topic_has_problem := true;
              issues := issues || jsonb_build_array(jsonb_build_object(
                'severity', 'error', 'type', 'missing-section-media', 'path', topic_path,
                'message', 'Una sezione media non ha mediaRef né URL.'
              ));
            elsif btrim(coalesce(section->>'mediaRef', '')) <> ''
               and not ((section->>'mediaRef') = any(media_ids)) then
              errors_count := errors_count + 1;
              topic_has_problem := true;
              issues := issues || jsonb_build_array(jsonb_build_object(
                'severity', 'error', 'type', 'broken-media-ref', 'path', topic_path,
                'message', 'MediaRef inesistente: ' || (section->>'mediaRef') || '.'
              ));
            end if;
          elsif section->>'type' = 'gallery' then
            for gallery_item in
              select value from jsonb_array_elements(coalesce(section->'items', '[]'::jsonb))
            loop
              if jsonb_typeof(gallery_item) = 'string'
                 and not ((gallery_item #>> '{}') = any(media_ids)) then
                errors_count := errors_count + 1;
                topic_has_problem := true;
                issues := issues || jsonb_build_array(jsonb_build_object(
                  'severity', 'error', 'type', 'broken-gallery-media-ref', 'path', topic_path,
                  'message', 'La galleria usa un mediaRef inesistente: ' || (gallery_item #>> '{}') || '.'
                ));
              end if;
            end loop;
          end if;
        end loop;

        for source in
          select value from jsonb_array_elements(coalesce(topic->'sources', '[]'::jsonb))
        loop
          if btrim(coalesce(source->>'ref', '')) = '' then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'missing-source-ref', 'path', topic_path,
              'message', 'Una fonte non ha ref.'
            ));
          elsif cardinality(source_ids) > 0
             and not ((source->>'ref') = any(source_ids)) then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'unknown-source-ref', 'path', topic_path,
              'message', 'Fonte non trovata nella lezione: ' || (source->>'ref') || '.'
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
          if position('/' in prerequisite) = 0
             and not (prerequisite = any(topic_ids)) then
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
              'message', 'Target locale non trovato: ' || (connection->>'target') || '.'
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
      'totalTopics', total_topics,
      'media', total_media
    ),
    'issues', issues
  );
end;
$$;

create or replace function public.studylibrary_api_catalog_id(p_catalog_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  candidate uuid;
  matches integer;
begin
  if p_catalog_key is null or btrim(p_catalog_key) = '' then
    return null;
  end if;

  begin
    candidate := p_catalog_key::uuid;
    if exists (
      select 1 from public.catalogs c
      where c.id = candidate and c.api_public = true
    ) then
      return candidate;
    end if;
  exception when invalid_text_representation then
    null;
  end;

  select count(*), min(c.id)
  into matches, candidate
  from public.catalogs c
  where c.api_public = true
    and c.slug = p_catalog_key;

  if matches = 1 then
    return candidate;
  end if;

  return null;
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
  catalog_id uuid;
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
begin
  catalog_id := public.studylibrary_api_catalog_id(catalog_key);
  if catalog_id is null then
    return jsonb_build_object(
      'error', 'catalog_not_found_or_ambiguous',
      'hint', 'Use the API-public catalog UUID for a stable lookup.'
    );
  end if;

  select c.* into row_catalog
  from public.catalogs c
  where c.id = catalog_id;

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
  catalog_id uuid;
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
  audit jsonb;
  stable_key text;
begin
  catalog_id := public.studylibrary_api_catalog_id(catalog_key);
  if catalog_id is null then
    return jsonb_build_object(
      'error', 'catalog_not_found_or_ambiguous',
      'hint', 'Use the API-public catalog UUID. Slugs are accepted only when unique.'
    );
  end if;

  select c.* into row_catalog
  from public.catalogs c
  where c.id = catalog_id;

  filtered := public.api_filter_catalog(row_catalog.catalog_json);
  audit := public.studylibrary_catalog_audit_json(filtered);
  stable_key := row_catalog.id::text;

  return jsonb_build_object(
    'protocol', 'studylibrary',
    'protocolVersion', '1.1',
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
    ),
    'media', jsonb_build_object(
      'supported', jsonb_build_array('image', 'video', 'gallery', 'embed'),
      'registry', 'catalog.media',
      'rule', 'Prefer mediaRef. External media must preserve sourceUrl, attribution and license when known.'
    )
  );
end;
$$;

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
  section jsonb;
  media_asset jsonb;
  gallery_item jsonb;
  media_ids text[] := '{}';
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

  for media_asset in
    select value from jsonb_array_elements(coalesce(p_catalog->'media', '[]'::jsonb))
  loop
    if btrim(coalesce(media_asset->>'id', '')) = '' then
      errors := array_append(errors, 'Media id is required');
    else
      media_ids := array_append(media_ids, media_asset->>'id');
    end if;
    if coalesce(media_asset->>'type', '') not in ('image', 'video') then
      errors := array_append(errors, 'Media type must be image or video');
    end if;
    if btrim(coalesce(media_asset->>'url', '')) = '' then
      errors := array_append(errors, 'Media URL is required');
    end if;
  end loop;

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
             from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) as sec(value)
             where sec.value->>'type' = 'checkpoint'
           ) then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' must contain a checkpoint');
        end if;

        for section in
          select value from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb))
        loop
          if section->>'type' in ('image', 'video') then
            if btrim(coalesce(section->>'mediaRef', '')) <> ''
               and not ((section->>'mediaRef') = any(media_ids)) then
              errors := array_append(errors, 'Unknown mediaRef ' || (section->>'mediaRef'));
            elsif btrim(coalesce(section->>'mediaRef', '')) = ''
               and btrim(coalesce(section->>'url', section->>'src', '')) = '' then
              errors := array_append(errors, 'Media section requires mediaRef or URL');
            end if;
          elsif section->>'type' = 'gallery' then
            for gallery_item in
              select value from jsonb_array_elements(coalesce(section->'items', '[]'::jsonb))
            loop
              if jsonb_typeof(gallery_item) = 'string'
                 and not ((gallery_item #>> '{}') = any(media_ids)) then
                errors := array_append(errors, 'Unknown gallery mediaRef ' || (gallery_item #>> '{}'));
              end if;
            end loop;
          end if;
        end loop;
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

  if p_base_version is not null
     and p_base_version <> current_row.current_version then
    raise exception 'version_conflict: current version is %', current_row.current_version;
  end if;

  validation_errors := public.studylibrary_catalog_json_errors(p_catalog);
  if cardinality(validation_errors) > 0 then
    raise exception 'invalid_catalog: %',
      array_to_string(validation_errors[1:least(cardinality(validation_errors), 12)], '; ');
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

  select c.* into current_row
  from public.catalogs c
  where c.id = p_catalog_id;

  return jsonb_build_object(
    'catalogId', current_row.id,
    'version', current_row.current_version,
    'updatedAt', current_row.updated_at,
    'apiPublic', current_row.api_public,
    'published', current_row.is_public
  );
end;
$$;

-- Only the intended public wrapper RPCs are executable by API roles.
revoke all on function public.studylibrary_catalog_stats(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_catalog_audit_json(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_api_catalog_id(text) from public, anon, authenticated;
revoke all on function public.studylibrary_catalog_json_errors(jsonb) from public, anon, authenticated;

revoke all on function public.studylibrary_catalog_audit(text) from public;
grant execute on function public.studylibrary_catalog_audit(text) to anon, authenticated;

revoke all on function public.studylibrary_catalog_agent(text) from public;
grant execute on function public.studylibrary_catalog_agent(text) to anon, authenticated;

revoke all on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) from public;
revoke all on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) from anon;
grant execute on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) to authenticated;
