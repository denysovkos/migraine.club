# Deploying to Render

Production runs on Render as a Docker web service described by
[`render.yaml`](../render.yaml). It is built from [`Dockerfile`](../Dockerfile),
the image CI builds on every pull request: the Go server and the client build in
a distroless image. The server applies pending migrations when it starts, under
an advisory lock. To apply them without starting the server, run the binary as
`server migrate` (locally: `npm run migrate -w @migraine/server`, which reads
`.env`).

## Moving the existing service to Docker

The service that runs today (`migraine.club`, `srv-d4mpc5vpm1nc73d49qv0`) uses
Render's Node runtime, and its build command downloads Go first. Render cannot
change a service's runtime, so the move is a new service next to the old one,
then a switch of the domains. Both services use the same database. Scheduled
jobs are HTTP calls with a lease in the database, so the two never run a job
twice while both are up.

1. **Note the old service's settings.** In the dashboard, open the old service:
   - *Environment*: keep the tab open, you copy every value from it in step 3.
   - *Shell*: run `du -sh /var/data/*` and `echo $FILES_STORAGE_PATH` to see
     what is on the disk (doctor verification uploads).
2. **Create the new service from the Blueprint.** *Blueprints → New Blueprint
   Instance*, pick the repository and `main`. Render reads `render.yaml` and
   asks for each variable marked `sync: false`: paste the values from the old
   service. `NEXT_PUBLIC_APP_URL` stays `https://www.migraine.club`.
3. **Wait for the first deploy** and open the new service's
   `*.onrender.com` URL. The log shows `Database migrations applied` with
   `applied: 0` (same database) and `listening`. Sign in and check the
   dashboard.
4. **Copy the disk, if step 1 found files.** Render disks belong to one
   service. With SSH set up for your account:
   ```sh
   ssh srv-d4mpc5vpm1nc73d49qv0@ssh.frankfurt.render.com 'tar -C /var/data -czf - .' > data.tgz
   ssh <new-service-id>@ssh.frankfurt.render.com 'tar -C /var/data -xzf -' < data.tgz
   ```
   If the disk only holds empty folders, skip this.
5. **Move the domains.** On the old service, *Settings → Custom Domains*:
   remove `www.migraine.club` and the other two. Add the same three on the new
   service. DNS points at Render, not at a service, so the records stay as
   they are; Render issues the certificates within minutes.
6. **Point the scheduler at the new service** if it calls the
   `*.onrender.com` URL rather than the domain.
7. **Watch it for a day**, then suspend the old service, and delete it once
   you are sure (its disk goes with it).

## Without Docker

The old way still works for a native Node service: build command
`curl -fsSL https://go.dev/dl/go1.27.4.linux-amd64.tar.gz | tar -xz -C /tmp && export PATH=/tmp/go/bin:$PATH && npm ci && npm run build`,
start command `npm run start`. The trade-off is a Go download on every build
and a build that differs from the image CI tests.
