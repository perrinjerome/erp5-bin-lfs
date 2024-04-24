
# this dump was generated with --erp5_sql_connection_string 'erp5_test_0@erp5-catalog-0:2099               testuser_0 testpassword0'

actual_connection_string = b'erp5_test_0@erp5-catalog-0:2099               testuser_0 testpassword0'
marker_connection_string = b'CONNECTION_STRING_REPLACED_BY_TEST_INIT_______________________________'

with open('Data.fs', 'rb') as f:
  data = f.read()

assert actual_connection_string in data
assert len(actual_connection_string) == len(marker_connection_string)

with open('Data.fs', 'wb') as f:
  f.write(data.replace(actual_connection_string, marker_connection_string))

