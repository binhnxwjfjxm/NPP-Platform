-- Chuyển MỘT bảng giá Theo kênh -> Theo nhóm khách + Kênh đã chọn.
-- Chỉ chạy trong migration operation có duyệt, backup + restore rehearsal; không auto-apply.
-- Caller SET LOCAL npp.price_scope.* bằng thông tin đọc trực tiếp từ DB.
DO $scope_correction$
DECLARE
  v_installation text := NULLIF(current_setting('npp.price_scope.installation_id', true), '');
  v_list_code text := NULLIF(current_setting('npp.price_scope.list_code', true), '');
  v_channel_code text := NULLIF(current_setting('npp.price_scope.channel_code', true), '');
  v_group_code text := NULLIF(current_setting('npp.price_scope.group_code', true), '');
  v_actor text := NULLIF(current_setting('npp.price_scope.actor_id', true), '');
  v_request text := NULLIF(current_setting('npp.price_scope.request_id', true), '');
  v_expected_text text := NULLIF(current_setting('npp.price_scope.expected_active_items', true), '');
  v_expected bigint;
  v_actual_channel text;
  v_group_id uuid;
  v_active bigint;
  v_active_after bigint;
  v_before shared.price_lists%ROWTYPE;
  v_after shared.price_lists%ROWTYPE;
BEGIN
  IF v_installation IS NULL OR v_list_code IS NULL OR v_channel_code IS NULL
      OR v_group_code IS NULL OR v_actor IS NULL OR v_request IS NULL
      OR v_expected_text IS NULL THEN
    RAISE EXCEPTION 'price_scope_correction_missing_explicit_context';
  END IF;
  IF length(v_actor) > 128 OR length(v_request) > 128
      OR v_expected_text !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'price_scope_correction_invalid_context';
  END IF;
  v_expected := v_expected_text::bigint;

  SELECT pl.* INTO v_before
    FROM shared.price_lists pl
   WHERE pl.installation_id = v_installation AND pl.code = v_list_code
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'price_scope_correction_list_not_found';
  END IF;
  SELECT sc.code INTO v_actual_channel
    FROM shared.sales_channels sc
   WHERE sc.installation_id = v_installation AND sc.id = v_before.channel_id;
  IF v_actual_channel IS DISTINCT FROM v_channel_code THEN
    RAISE EXCEPTION 'price_scope_correction_channel_mismatch';
  END IF;
  SELECT cg.id INTO v_group_id
    FROM shared.customer_groups cg
   WHERE cg.installation_id = v_installation AND cg.code = v_group_code AND cg.is_active;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'price_scope_correction_group_not_found_or_inactive';
  END IF;
  IF v_before.list_type = 'CUSTOMER_GROUP' THEN
    IF v_before.customer_group_id IS DISTINCT FROM v_group_id
       OR v_before.customer_id IS NOT NULL THEN
      RAISE EXCEPTION 'price_scope_correction_already_scoped_differently';
    END IF;
    RAISE NOTICE 'price_scope_correction_already_applied';
    RETURN;
  END IF;
  IF v_before.list_type <> 'CHANNEL' OR v_before.customer_group_id IS NOT NULL
      OR v_before.customer_id IS NOT NULL THEN
    RAISE EXCEPTION 'price_scope_correction_wrong_original_scope';
  END IF;

  SELECT count(*) INTO v_active
    FROM shared.price_list_items pi
   WHERE pi.installation_id = v_installation AND pi.price_list_id = v_before.id
     AND pi.is_active;
  IF v_active <> v_expected OR v_active = 0 THEN
    RAISE EXCEPTION 'price_scope_correction_active_items_mismatch_expected_%_actual_%', v_expected, v_active;
  END IF;

  UPDATE shared.price_lists
     SET list_type = 'CUSTOMER_GROUP',
         customer_group_id = v_group_id,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = v_actor
   WHERE id = v_before.id AND installation_id = v_installation
     AND list_type = 'CHANNEL' AND customer_group_id IS NULL
   RETURNING * INTO v_after;
  IF v_after.id IS DISTINCT FROM v_before.id THEN
    RAISE EXCEPTION 'price_scope_correction_identity_changed';
  END IF;
  SELECT count(*) INTO v_active_after
    FROM shared.price_list_items pi
   WHERE pi.installation_id = v_installation AND pi.price_list_id = v_before.id
     AND pi.is_active;
  IF v_active_after <> v_active THEN
    RAISE EXCEPTION 'price_scope_correction_items_changed';
  END IF;

  INSERT INTO shared.core_audit_records (
    audit_id, installation_id, actor_id, source_app, request_id, action,
    resource_type, resource_id, before_data, after_data, metadata
  ) VALUES (
    gen_random_uuid(), v_installation, v_actor, 'NPP_OPERATIONS', v_request,
    'price_list.scope_correction', 'price_list', v_before.id::text,
    jsonb_build_object('listType', v_before.list_type, 'channelId', v_before.channel_id,
                       'customerGroupId', v_before.customer_group_id),
    jsonb_build_object('listType', v_after.list_type, 'channelId', v_after.channel_id,
                       'customerGroupId', v_after.customer_group_id),
    jsonb_build_object('priceListCode', v_list_code, 'channelCode', v_channel_code,
                       'customerGroupCode', v_group_code, 'activeItemsUnchanged', v_active_after)
  );
END
$scope_correction$;
