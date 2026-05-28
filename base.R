library(tidyverse)
library(jsonlite)
library(writexl)

files <- c("data/zig.json",
           "data/clojure.json",
           "data/elixir.json",
           "data/ocaml.json")

raw <- bind_rows(lapply(files, function(f) tibble(fromJSON(f, flatten = TRUE)$repos)))

unique(raw$language)
repos <- raw %>%
  mutate(
    created_at = as.POSIXct(created_at, format = "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    updated_at = as.POSIXct(updated_at, format = "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    pushed_at  = as.POSIXct(pushed_at, format = "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    language   = map_chr(language, 1)
  )

repos <- filter(repos, language %in% c("Clojure", "Elixir", "Zig", "OCaml"))

repos <- filter(repos, owner_type == "User")

right_sensoring_date = as.POSIXct("2026-05-01", tz = "UTC") - years(1)

repos <- repos %>%
  arrange(owner_login, created_at) %>%
  group_by(owner_login, language) %>%
  mutate(
    owner_repo_sequence = case_when(
      n() == 1                        ~ "Only",
      row_number() == 1               ~ "First",
      row_number() == n() & created_at < right_sensoring_date ~ "Last",
      row_number() == n()             ~ "Other",
      TRUE                            ~ "Other"
    )
  ) %>%
  ungroup()

replacement_rate <- repos %>%
  mutate(year = format(created_at, "%Y")) %>%
  group_by(year, language) %>%
  summarise(
    first_count = sum(owner_repo_sequence == "First") + sum(owner_repo_sequence == "Only"),
    last_count  = sum(owner_repo_sequence == "Last") + sum(owner_repo_sequence == "Only" & created_at < right_sensoring_date),
    rate        = first_count / last_count
  ) %>%
  filter(as.integer(year) >= 2020, as.integer(year) < as.integer(format(right_sensoring_date, "%Y")))

replacement_rate_full <- repos %>%
  mutate(year = format(created_at, "%Y")) %>%
  group_by(year, language) %>%
  summarise(
    first_count = sum(owner_repo_sequence == "First") + sum(owner_repo_sequence == "Only"),
    last_count  = sum(owner_repo_sequence == "Last") + sum(owner_repo_sequence == "Only" & created_at < right_sensoring_date),
    rate        = first_count / last_count
  ) %>%
  filter(as.integer(year) < as.integer(format(right_sensoring_date, "%Y")))

n_repos_total    <- nrow(repos)
n_owners_total   <- n_distinct(repos$owner_login)

repos <- filter(repos, created_at >= "2020-01-01")

#lang_colors <- c(
#  "Clojure" = "#1565C0",
#  "Elixir"  = "#E87722",
#  "Zig"    = "#6A1B9A",
#  "Erlang"    = "#000000"
#)

#lang_linetypes <- c(
#  "Clojure" = "solid",
#  "Elixir"  = "dashed",
#  "Zig"    = "solid",
#  "Erlang"    = "solid"
#)