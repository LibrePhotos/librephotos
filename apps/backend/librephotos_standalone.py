"""Entry point of the standalone build; see librephotos/standalone.py."""

from librephotos.standalone import bootstrap_process, main

bootstrap_process()

if __name__ == "__main__":
    main()
