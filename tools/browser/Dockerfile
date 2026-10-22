FROM python:3.12-slim

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY \
    HTTPS_PROXY=$HTTPS_PROXY \
    NO_PROXY=$NO_PROXY \
    http_proxy=$HTTP_PROXY \
    https_proxy=$HTTPS_PROXY \
    no_proxy=$NO_PROXY

# Optional: a local forward-proxy CA to trust (e.g. a sandboxed dev environment
# that MITMs HTTPS). Copy the whole directory (it always exists, via .gitkeep) so
# the build works when no CA is present; only *.crt files are picked up.
COPY certs/ /usr/local/share/ca-certificates/

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && update-ca-certificates \
  && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  && apt-get install -y --no-install-recommends /tmp/chrome.deb \
  && rm -rf /tmp/chrome.deb /var/lib/apt/lists/*

WORKDIR /tools
COPY *.py ./

# Usage: docker run --rm -v "$PWD/shots:/out" web-view-browser shot.py URL -o /out/x.png
#        docker run --rm web-view-browser probe.py console URL
ENTRYPOINT ["python3"]
