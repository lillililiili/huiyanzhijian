-- An acknowledgement ID is owned by its device, not globally unique across vendors.
ALTER TABLE m02.binding_ack DROP CONSTRAINT binding_ack_pkey;
ALTER TABLE m02.binding_ack DROP CONSTRAINT binding_ack_device_id_id_key;
ALTER TABLE m02.binding_ack ADD PRIMARY KEY(device_id,id);
