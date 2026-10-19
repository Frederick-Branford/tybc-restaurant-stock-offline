# SANDBOX SUBSTITUTE ONLY. Ubuntu noble nginx 1.24 with the official-image template convention.
FROM tybc-spike/base:noble
RUN mkdir -p /etc/nginx/templates && rm -f /etc/nginx/sites-enabled/default
COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
