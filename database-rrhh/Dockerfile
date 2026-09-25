FROM mysql:8.0

# Copiamos el script SQL para que MySQL lo ejecute automáticamente al iniciar por primera vez
COPY schema_mysql.sql /docker-entrypoint-initdb.d/