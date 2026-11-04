FROM influxdb:2.9.1
WORKDIR /opt/huiyan-edge
COPY huiyan-edge /opt/huiyan-edge/bin/huiyan-edge
COPY run-services.sh run-influx.sh /opt/huiyan-edge/
RUN ln -s /usr/local/bin/influxd /opt/huiyan-edge/bin/influxd && chmod 755 /opt/huiyan-edge/bin/huiyan-edge /opt/huiyan-edge/*.sh
ENV EDGE_DATA_DIR=/var/lib/huiyan-edge
ENTRYPOINT ["/bin/sh", "/opt/huiyan-edge/run-services.sh"]
