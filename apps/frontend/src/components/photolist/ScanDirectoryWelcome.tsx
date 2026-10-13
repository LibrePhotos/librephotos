import type { User } from "@librephotos/api-client";
import { Box, Button, Center, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconFolderSearch, IconPhoto as Photo } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalUserEdit } from "../modals/ModalUserEdit";

type Props = Readonly<{
  userSelfDetails: User | undefined;
  userList: React.ComponentProps<typeof ModalUserEdit>["userList"];
}>;

// The timeline of an admin without a scan directory: a welcome and the button that sets one up.
export function ScanDirectoryWelcome({ userSelfDetails, userList }: Props) {
  const { t } = useTranslation();
  const [modalOpen, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [userToEdit, setUserToEdit] = useState<Partial<User>>({});

  return (
    <Center h="calc(100vh - 120px)">
      <Stack align="center" gap="lg">
        <ThemeIcon size={80} radius="xl" variant="light" color="green">
          <IconFolderSearch size={45} />
        </ThemeIcon>
        <Box ta="center">
          <Title order={2} mb="xs">
            {t("defaultheader.welcome")}
          </Title>
          <Text c="dimmed" size="lg" maw={400}>
            {t("defaultheader.setup")}
          </Text>
        </Box>
        <Button
          size="md"
          color="green"
          leftSection={<Photo size={18} />}
          onClick={() => {
            setUserToEdit({ ...userSelfDetails });
            openModal();
          }}
        >
          {t("defaultheader.gettingstarted")}
        </Button>
        <ModalUserEdit
          onRequestClose={() => {
            closeModal();
          }}
          userToEdit={userToEdit}
          isOpen={modalOpen}
          updateAndScan
          userList={userList}
          createNew={false}
          firstTimeSetup
        />
      </Stack>
    </Center>
  );
}
