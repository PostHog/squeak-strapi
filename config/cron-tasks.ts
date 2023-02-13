import simpleGit from "simple-git";
import glob from "glob";
import fs from "fs";

type ContributorData = {
  lastUpdated: string;
  contributors: {
    avatar: string;
    username: string;
    url: string;
  }[];
};

// queries github api to get all contributors for a given file
async function getContributors(path: string): Promise<ContributorData> {
  try {
    const url = `https://api.github.com/repos/posthog/posthog.com/commits?path=${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${process.env.GITHUB_API_KEY}`,
      },
    });

    if (res.status !== 200) {
      console.error(`Got status code ${res.status}`);
    }

    let contributors = await res.json();

    if (!contributors || contributors.length <= 0) {
      throw new Error("No contributors found");
    }

    const lastUpdated = contributors[0]?.commit?.author?.date;

    const uniqueContributors: Record<string, any> = contributors
      .filter((contributor) => contributor?.author?.login)
      .reduce((acc, contributor) => {
        if (contributor.author.login in acc) {
          return acc;
        }

        acc[contributor.author.login] = contributor;
        return acc;
      }, {});

    const data = {
      lastUpdated,
      contributors: Object.values(uniqueContributors).map((contributor) => {
        const { author } = contributor;
        const avatar = author && author.avatar_url;
        return {
          avatar,
          url: author && author.html_url,
          username: author && author.login,
        };
      }),
    };

    return data;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export default {
  "*/45 * * * *": async ({ strapi }) => {
    console.log("starting github sync");

    // clone posthog.com
    await simpleGit()
      .clone("https://github.com/PostHog/posthog.com.git")
      .then(() => console.log("finished"))
      .catch((err) => console.error("failed: ", err));

    // get all markdown/mdx file paths
    const files = glob.sync("posthog.com/{src,contents}/**/*.{mdx,md}", {
      nosort: true,
      nodir: true,
    });

    // delete all current pages
    await strapi.db.query("api::page.page").deleteMany({
      where: {},
    });

    // create page for each markdown/mdx file
    for (const file of files) {
      const path = file.replace("posthog.com/", "");
      const { contributors, lastUpdated } = await getContributors(path);
      const data = {
        path,
        contributors,
        lastUpdated,
      };
      await strapi.db.query("api::page.page").create({
        data,
      });
    }

    // delete posthog.com folder
    fs.rmSync("posthog.com", { recursive: true, force: true });

    console.log("completed github sync");
  },
};
